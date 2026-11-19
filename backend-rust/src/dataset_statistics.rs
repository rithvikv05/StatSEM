//! Dataset-level tests. Inputs are complete numeric observations selected by the client.
use crate::{inference, stats};
use serde_json::{json, Value};

fn sample(value: &Value) -> Result<Vec<f64>, String> {
    let values = value.as_array().ok_or("Expected a numeric sample")?;
    values.iter().map(|v| v.as_f64().filter(|x| x.is_finite()).ok_or_else(|| "Sample contains a non-numeric value".to_string())).collect()
}

fn jarque_bera(x: &[f64]) -> Option<Value> {
    if x.len() < 8 { return None; }
    let n=x.len() as f64; let m=stats::mean(x,None);
    let m2=x.iter().map(|v|(v-m).powi(2)).sum::<f64>()/n;
    if m2 <= 0.0 { return None; }
    let skew=x.iter().map(|v|(v-m).powi(3)).sum::<f64>()/n/m2.powf(1.5);
    let kurt=x.iter().map(|v|(v-m).powi(4)).sum::<f64>()/n/m2.powi(2)-3.0;
    let stat=n/6.0*(skew*skew+kurt*kurt/4.0);
    Some(json!({"n":x.len(),"statistic":stat,"p_value":(-stat/2.0).exp()}))
}
fn welch(a: &[f64], b: &[f64]) -> Option<(f64,f64,f64)> {
    if a.len()<2 || b.len()<2 { return None; }
    let va=stats::variance(a,None,1)/a.len() as f64;
    let vb=stats::variance(b,None,1)/b.len() as f64;
    let se=(va+vb).sqrt();
    let df=(va+vb).powi(2)/(va.powi(2)/(a.len()-1) as f64+vb.powi(2)/(b.len()-1) as f64);
    if se<=0.0 || !df.is_finite() { return None; }
    let difference=stats::mean(a,None)-stats::mean(b,None);
    Some((difference,df,2.0*inference::student_t_cdf(-(difference/se).abs(),df)))
}
fn brown_forsythe(groups: &[Vec<f64>]) -> Option<Value> {
    if groups.len()<2 || groups.iter().any(|g|g.len()<2) { return None; }
    let deviations:Vec<Vec<f64>>=groups.iter().map(|g|{
        let mut sorted=g.clone(); sorted.sort_by(f64::total_cmp);
        let n=sorted.len(); let median=if n%2==0 {(sorted[n/2-1]+sorted[n/2])/2.0} else {sorted[n/2]};
        g.iter().map(|x|(x-median).abs()).collect()
    }).collect();
    let n:usize=deviations.iter().map(Vec::len).sum(); let k=deviations.len();
    let avg=deviations.iter().flatten().sum::<f64>()/n as f64;
    let between=deviations.iter().map(|g|g.len() as f64*(stats::mean(g,None)-avg).powi(2)).sum::<f64>();
    let within=deviations.iter().map(|g|{let m=stats::mean(g,None);g.iter().map(|v|(v-m).powi(2)).sum::<f64>()}).sum::<f64>();
    if within<=0.0 { return None; }
    let df1=(k-1) as f64; let df2=(n-k) as f64;
    let f=(between/df1)/(within/df2);
    Some(json!({"statistic":f,"df1":df1,"df2":df2,"p_value":inference::regularized_beta(df2/2.0,df1/2.0,df2/(df2+df1*f))}))
}
fn pairwise(groups: &[Vec<f64>]) -> Vec<Value> {
    let mut rows=Vec::new();
    for i in 0..groups.len() { for j in i+1..groups.len() {
        if let Some((diff,df,p))=welch(&groups[i],&groups[j]) {
            rows.push((i,j,diff,df,p));
        }
    }}
    let mut order:Vec<usize>=(0..rows.len()).collect();
    order.sort_by(|a,b|rows[*a].4.total_cmp(&rows[*b].4));
    let mut adjusted=vec![0.0;rows.len()]; let mut running: f64=0.0;
    for (rank,idx) in order.into_iter().enumerate() {
        let total=groups.len()*(groups.len()-1)/2;
        running=running.max((rows[idx].4*(total-rank) as f64).min(1.0));
        adjusted[idx]=running;
    }
    rows.iter().enumerate().map(|(i,(a,b,d,df,p))|json!({"group_a":a,"group_b":b,"difference":d,"df":df,"p_value":p,"adjusted_p_value":adjusted[i]})).collect()
}

// Reorthogonalized modified Gram–Schmidt; normalized inputs make the rank
// check independent of the units used for the covariates.
fn orthonormal(columns: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, String> {
    let mut basis: Vec<Vec<f64>> = Vec::new();
    for col in columns {
        let original = col.iter().map(|x| x*x).sum::<f64>().sqrt();
        if original == 0.0 { return Err("The model has a constant or redundant predictor".into()); }
        let mut v: Vec<f64> = col.iter().map(|x| x/original).collect();
        for _ in 0..2 { for q in &basis {
            let dot = v.iter().zip(q).map(|(x,y)|x*y).sum::<f64>();
            for (x,y) in v.iter_mut().zip(q) { *x -= dot*y; }
        }}
        let norm=v.iter().map(|x|x*x).sum::<f64>().sqrt();
        if norm < 1e-10 { return Err("The model is rank deficient; check the groups and covariates".into()); }
        basis.push(v.into_iter().map(|x|x/norm).collect());
    }
    Ok(basis)
}
fn residuals(y: &[f64], basis: &[Vec<f64>]) -> Vec<f64> {
    let mut result=y.to_vec();
    for q in basis {
        let dot=y.iter().zip(q).map(|(x,z)|x*z).sum::<f64>();
        for (v,z) in result.iter_mut().zip(q) { *v-=dot*z; }
    }
    result
}
// Contrast variances are computed from the QR basis rather than normal equations.
fn adjusted_comparisons(columns: &[Vec<f64>], basis: &[Vec<f64>], outcomes: &[Vec<f64>], residual: &[Vec<f64>], contrasts: &[(usize,usize,usize,Vec<f64>)], df: f64) -> Vec<Value> {
    let k=columns.len();
    let r:Vec<Vec<f64>>=(0..k).map(|i|(0..k).map(|j|if j<i {0.0}else{basis[i].iter().zip(&columns[j]).map(|(a,b)|a*b).sum()}).collect()).collect();
    let mut rows:Vec<(usize,usize,usize,usize,f64,f64)>=Vec::new();
    for (factor,a,b,c) in contrasts {
        let mut z=vec![0.0;k];
        for i in 0..k { z[i]=(c[i]-(0..i).map(|j|r[j][i]*z[j]).sum::<f64>())/r[i][i]; }
        let norm=z.iter().map(|v|v*v).sum::<f64>();
        for (index,y) in outcomes.iter().enumerate() {
            let estimate=z.iter().zip(basis).map(|(v,q)|v*q.iter().zip(y).map(|(a,b)|a*b).sum::<f64>()).sum::<f64>();
            let mse=residual[index].iter().map(|v|v*v).sum::<f64>()/df;
            let se=(mse*norm).sqrt();
            if se>0.0 && se.is_finite() {
                let p=2.0*inference::student_t_cdf(-(estimate/se).abs(),df);
                rows.push((*factor,index,*a,*b,estimate,p));
            }
        }
    }
    let mut order:Vec<_>=(0..rows.len()).collect(); order.sort_by(|a,b|rows[*a].5.total_cmp(&rows[*b].5));
    let total=contrasts.len()*outcomes.len(); let mut previous:f64=0.0; let mut adjusted=vec![0.0;rows.len()];
    for (rank,index) in order.into_iter().enumerate() { previous=previous.max((rows[index].5*(total-rank) as f64).min(1.0)); adjusted[index]=previous; }
    rows.iter().enumerate().map(|(i,(factor,outcome,a,b,estimate,p))|json!({"factor":factor,"outcome":outcome,"group_a":a,"group_b":b,"difference":estimate,"df":df,"p_value":p,"adjusted_p_value":adjusted[i]})).collect()
}
fn logdet(matrix: &[Vec<f64>]) -> Result<f64,String> {
    let n=matrix.len(); let mut l=vec![vec![0.0;n];n]; let mut sum=0.0;
    let scale=(0..n).map(|i|matrix[i][i].abs()).fold(0.0,f64::max);
    for i in 0..n { for j in 0..=i {
        let v=matrix[i][j]-(0..j).map(|k|l[i][k]*l[j][k]).sum::<f64>();
        if i==j {
            if v<=scale*1e-12 { return Err("Outcome residual covariance is singular; check dependent variables and sample size".into()); }
            l[i][j]=v.sqrt(); sum+=2.0*l[i][j].ln();
        } else { l[i][j]=v/l[j][j]; }
    }}
    Ok(sum)
}
fn comparison(body: &Value, kind: &str) -> Result<Value,String> {
    let outcomes: Vec<Vec<f64>>=body["outcomes"].as_array().ok_or("Select outcome variables")?.iter().map(sample).collect::<Result<_,_>>()?;
    let covariates: Vec<Vec<f64>>=body["covariates"].as_array().ok_or("Expected covariates")?.iter().map(sample).collect::<Result<_,_>>()?;
    let groups=body["group_codes"].as_array().ok_or("Select a grouping variable")?;
    let n=groups.len(); let p=outcomes.len();
    if (kind=="ancova" && p!=1) || (kind!="ancova" && p<2) { return Err("Select the required number of outcome variables".into()); }
    if (kind=="ancova" || kind=="mancova") && covariates.is_empty() { return Err("Select at least one covariate".into()); }
    if n==0 || p>10 || covariates.len()>10 || outcomes.iter().chain(&covariates).any(|x|x.len()!=n) { return Err("Invalid model dimensions".into()); }
    let codes=groups.iter().map(|v|v.as_u64().ok_or("Invalid group code")).collect::<Result<Vec<_>,_>>()?;
    let mut levels=codes.clone(); levels.sort_unstable(); levels.dedup();
    if levels.len()<2 || levels.len()>30 { return Err("Choose a grouping variable with 2 to 30 groups".into()); }
    let mut reduced=vec![vec![1.0;n]]; reduced.extend(covariates.clone());
    let mut full=reduced.clone();
    for level in levels.iter().skip(1) { full.push(codes.iter().map(|code|if code==level {1.0}else{0.0}).collect()); }
    if n<=full.len()+p-1 { return Err("Too few complete observations for this model".into()); }
    let reduced_basis=orthonormal(&reduced)?; let full_basis=orthonormal(&full)?;
    let full_res:Vec<_>=outcomes.iter().map(|y|residuals(y,&full_basis)).collect();
    let reduced_res:Vec<_>=outcomes.iter().map(|y|residuals(y,&reduced_basis)).collect();
    let cross=|r: &Vec<Vec<f64>>| (0..p).map(|i|(0..p).map(|j|r[i].iter().zip(&r[j]).map(|(a,b)|a*b).sum()).collect()).collect::<Vec<Vec<f64>>>();
    let error=cross(&full_res); let total=cross(&reduced_res);
    let df_error=(n-full.len()) as f64; let q=(levels.len()-1) as f64;
    let offset=reduced.len();
    let mut contrasts=Vec::new();
    for a in 0..levels.len() { for b in a+1..levels.len() {
        let mut c=vec![0.0;full.len()]; if a>0 {c[offset+a-1]+=1.0;} if b>0 {c[offset+b-1]-=1.0;}
        contrasts.push((0,levels[a] as usize,levels[b] as usize,c));
    }}
    let adjusted=adjusted_comparisons(&full,&full_basis,&outcomes,&full_res,&contrasts,df_error);
    if p==1 {
        let ss=total[0][0]-error[0][0];
        if error[0][0]<=0.0 { return Err("Residual variance is zero".into()); }
        let f=(ss.max(0.0)/q)/(error[0][0]/df_error);
        let prob=inference::regularized_beta(df_error/2.0,q/2.0,df_error/(df_error+q*f));
        let slope_homogeneity = if !covariates.is_empty() {
            let mut interaction=full.clone();
            for covariate in &covariates { for level in levels.iter().skip(1) {
                interaction.push(covariate.iter().zip(&codes).map(|(x,code)| if code==level {*x} else {0.0}).collect());
            }}
            let numerator=(interaction.len()-full.len()) as f64;
            let denominator=(n as f64)-(interaction.len() as f64);
            if denominator > 0.0 {
                orthonormal(&interaction).ok().and_then(|basis| {
                    let residual=residuals(&outcomes[0],&basis);
                    let sse=residual.iter().map(|v|v*v).sum::<f64>();
                    if sse<=0.0 { return None; }
                    let f=((error[0][0]-sse).max(0.0)/numerator)/(sse/denominator);
                    Some(json!({"statistic":f,"df1":numerator,"df2":denominator,"p_value":inference::regularized_beta(denominator/2.0,numerator/2.0,denominator/(denominator+numerator*f))}))
                })
            } else { None }
        } else { None };
        return Ok(json!({"n":n,"f":f,"df_group":q,"df_error":df_error,"p_value":prob,"partial_eta_squared":ss.max(0.0)/total[0][0],"adjusted_comparisons":adjusted,"diagnostics":{"residual_normality":jarque_bera(&full_res[0]),"group_by_covariate_interaction":slope_homogeneity}}));
    }
    let lambda=(logdet(&error)?-logdet(&total)?).exp().clamp(0.0,1.0);
    let pf=p as f64; let denominator=pf*pf+q*q-5.0;
    let ratio=if denominator>0.0 {(pf*pf*q*q-4.0)/denominator} else {1.0};
    let s=if ratio>0.0 {ratio.sqrt()} else {1.0};
    let df1=pf*q;
    let df2=s*(df_error-(pf-q+1.0)/2.0)-(df1-2.0)/2.0;
    if df2<=0.0 || lambda<=0.0 { return Err("Not enough residual degrees of freedom for the multivariate test".into()); }
    let root=lambda.powf(1.0/s);
    let f=(1.0-root)/root*df2/df1;
    let prob=inference::regularized_beta(df2/2.0,df1/2.0,df2/(df2+df1*f));
    Ok(json!({"n":n,"wilks_lambda":lambda,"approximate_f":f,"df_hypothesis":df1,"df_error":df2,"p_value":prob,"adjusted_comparisons":adjusted,"diagnostics":{"residual_normality":full_res.iter().map(|r|jarque_bera(r)).collect::<Vec<_>>()}}))
}

fn factorial(body: &Value) -> Result<Value,String> {
    let outcomes:Vec<Vec<f64>>=body["outcomes"].as_array().ok_or("Select outcomes")?.iter().map(sample).collect::<Result<_,_>>()?;
    let covariates:Vec<Vec<f64>>=body["covariates"].as_array().ok_or("Expected covariates")?.iter().map(sample).collect::<Result<_,_>>()?;
    let parse_codes=|key:&str| -> Result<Vec<u64>,String> { body[key].as_array().ok_or("Two factors are required")?.iter().map(|v|v.as_u64().ok_or_else(||"Invalid factor value".into())).collect() };
    let a=parse_codes("group_codes")?; let b=parse_codes("group2_codes")?;
    let n=a.len(); let p=outcomes.len();
    if p==0 || p>10 || covariates.len()>10 || b.len()!=n || outcomes.iter().chain(&covariates).any(|v|v.len()!=n) { return Err("Invalid factorial model dimensions".into()); }
    let mut al=a.clone(); al.sort_unstable(); al.dedup(); let mut bl=b.clone(); bl.sort_unstable(); bl.dedup();
    if al.len()<2 || bl.len()<2 || al.len()>12 || bl.len()>12 || al.len()*bl.len()>40 { return Err("Each factor needs 2 to 12 levels, with at most 40 combinations".into()); }
    let encode=|codes:&Vec<u64>,levels:&Vec<u64>| -> Vec<Vec<f64>> { levels.iter().take(levels.len()-1).map(|level|codes.iter().map(|c|if c==level {1.0} else if c==levels.last().unwrap() {-1.0} else {0.0}).collect()).collect() };
    let ac=encode(&a,&al); let bc=encode(&b,&bl);
    let include_interaction=body["interaction"].as_bool().unwrap_or(true);
    let mut columns=vec![vec![1.0;n]]; columns.extend(covariates.clone());
    let a_start=columns.len(); columns.extend(ac.clone()); let b_start=columns.len(); columns.extend(bc.clone());
    let interaction_start=columns.len();
    if include_interaction { for x in &ac { for y in &bc { columns.push(x.iter().zip(y).map(|(u,v)|u*v).collect()); } } }
    if n<=columns.len()+p-1 { return Err("Too few complete observations for this factorial model".into()); }
    let basis=orthonormal(&columns)?;
    let residual:Vec<_>=outcomes.iter().map(|y|residuals(y,&basis)).collect();
    let cross=|r: &Vec<Vec<f64>>| -> Vec<Vec<f64>> { (0..p).map(|i|(0..p).map(|j|r[i].iter().zip(&r[j]).map(|(x,y)|x*y).sum()).collect()).collect() };
    let error=cross(&residual); let df=(n-columns.len()) as f64;
    let mut terms=Vec::new();
    let mut blocks=vec![("factor_a",a_start,b_start),("factor_b",b_start,interaction_start)];
    if include_interaction { blocks.push(("interaction",interaction_start,columns.len())); }
    for (name,start,end) in blocks {
        let reduced:Vec<_>=columns.iter().enumerate().filter(|(i,_)|*i<start || *i>=end).map(|(_,v)|v.clone()).collect();
        let reduced_basis=orthonormal(&reduced)?;
        let reduced_res:Vec<_>=outcomes.iter().map(|y|residuals(y,&reduced_basis)).collect();
        let total=cross(&reduced_res); let q=(end-start) as f64;
        if p==1 {
            let ss=(total[0][0]-error[0][0]).max(0.0);
            if error[0][0]<=0.0 { return Err("Residual variance is zero".into()); }
            let f=(ss/q)/(error[0][0]/df);
            terms.push(json!({"term":name,"f":f,"df_hypothesis":q,"df_error":df,"p_value":inference::regularized_beta(df/2.0,q/2.0,df/(df+q*f)),"partial_eta_squared":ss/total[0][0]}));
        } else {
            let lambda=(logdet(&error)?-logdet(&total)?).exp().clamp(0.0,1.0); let pf=p as f64;
            let d=pf*pf+q*q-5.0; let ratio=if d>0.0 {(pf*pf*q*q-4.0)/d}else{1.0}; let s=if ratio>0.0{ratio.sqrt()}else{1.0};
            let df1=pf*q; let df2=s*(df-(pf-q+1.0)/2.0)-(df1-2.0)/2.0;
            if df2<=0.0 || lambda<=0.0 { return Err("Insufficient degrees of freedom for multivariate factorial test".into()); }
            let root=lambda.powf(1.0/s); let f=(1.0-root)/root*df2/df1;
            terms.push(json!({"term":name,"wilks_lambda":lambda,"f":f,"df_hypothesis":df1,"df_error":df2,"p_value":inference::regularized_beta(df2/2.0,df1/2.0,df2/(df2+df1*f))}));
        }
    }
    let mut contrasts=Vec::new();
    for (factor,start,labels) in [(0,a_start,&al),(1,b_start,&bl)] {
        let levels=labels.len();
        for i in 0..levels { for j in i+1..levels {
            let mut c=vec![0.0;columns.len()];
            for k in 0..levels-1 {
                let code=|v| if v==k {1.0}else if v==levels-1 {-1.0}else{0.0};
                c[start+k]=code(i)-code(j);
            }
            contrasts.push((factor,labels[i] as usize,labels[j] as usize,c));
        }}
    }
    let adjusted=adjusted_comparisons(&columns,&basis,&outcomes,&residual,&contrasts,df);
    Ok(json!({"n":n,"terms":terms,"adjusted_comparisons":adjusted,"interaction":include_interaction,"diagnostics":{"residual_normality":residual.iter().map(|r|jarque_bera(r)).collect::<Vec<_>>()}}))
}

pub fn calculate(body: &Value) -> Result<Value, String> {
    match body["test"].as_str().unwrap_or("") {
        "factorial" => factorial(body),
        "ancova" | "manova" | "mancova" => comparison(body, body["test"].as_str().unwrap_or("")),
        "normality" => {
            let mut x = sample(&body["values"])?;
            if x.len() < 3 { return Err("Normality tests need at least 3 non-missing observations".into()); }
            let n = x.len() as f64;
            let mean = stats::mean(&x, None);
            let m2 = x.iter().map(|v| (v-mean).powi(2)).sum::<f64>() / n;
            if m2 <= 0.0 { return Err("Normality cannot be assessed for a constant variable".into()); }
            let skew = x.iter().map(|v| (v-mean).powi(3)).sum::<f64>() / n / m2.powf(1.5);
            let kurt = x.iter().map(|v| (v-mean).powi(4)).sum::<f64>() / n / m2.powi(2) - 3.0;
            let jb = if x.len() >= 8 { Some(n / 6.0 * (skew * skew + kurt * kurt / 4.0)) } else { None };
            let shapiro = if x.len() <= 5000 { normality::shapiro_wilk(x.iter().copied()).ok().map(|r|json!({"statistic":r.statistic,"p_value":r.p_value})) } else { None };
            let lilliefors = if x.len() >= 5 { normality::lilliefors(x.iter().copied()).ok().map(|r|json!({"statistic":r.statistic,"p_value":r.p_value})) } else { None };
            x.sort_by(f64::total_cmp);
            let points = (0..x.len().min(200)).map(|i| {
                let index = if x.len() <= 200 { i } else { i * (x.len()-1) / 199 };
                json!([inference::normal_ppf((index as f64 + 0.5) / n), x[index]])
            }).collect::<Vec<_>>();
            let bins = (n.sqrt().ceil() as usize).clamp(5, 30);
            let min = x[0]; let max = x[x.len()-1];
            let mut counts = vec![0usize; bins];
            for v in &x { counts[(((v-min)/(max-min)*bins as f64) as usize).min(bins-1)] += 1; }
            Ok(json!({"n":x.len(),"mean":mean,"sd":m2.sqrt(),"skewness":skew,"excess_kurtosis":kurt,"statistic":jb,"p_value":jb.map(|v|(-v/2.0).exp()),"shapiro_wilk":shapiro,"lilliefors":lilliefors,"histogram":counts,"min":min,"max":max,"qq":points}))
        }
        "welch" | "paired" => {
            let a = sample(&body["a"])?; let b = sample(&body["b"])?;
            if a.len() < 2 || b.len() < 2 { return Err("Each sample needs at least two observations".into()); }
            let (difference, se, df) = if body["test"] == "paired" {
                if a.len() != b.len() { return Err("Paired samples must have the same number of complete pairs".into()); }
                let diff: Vec<_> = a.iter().zip(&b).map(|(x,y)| x-y).collect();
                (stats::mean(&diff,None), (stats::variance(&diff,None,1)/diff.len() as f64).sqrt(), (diff.len()-1) as f64)
            } else {
                let va=stats::variance(&a,None,1)/a.len() as f64; let vb=stats::variance(&b,None,1)/b.len() as f64;
                (stats::mean(&a,None)-stats::mean(&b,None), (va+vb).sqrt(), (va+vb).powi(2)/(va.powi(2)/(a.len()-1) as f64+vb.powi(2)/(b.len()-1) as f64))
            };
            if se <= 0.0 || !df.is_finite() { return Err("The test is undefined because the standard error is zero".into()); }
            let t=difference/se;
            let diagnostic=if body["test"]=="paired" {
                let differences:Vec<_>=a.iter().zip(&b).map(|(x,y)|x-y).collect(); json!({"difference_normality":jarque_bera(&differences)})
            } else {json!({"group_normality":[jarque_bera(&a),jarque_bera(&b)],"variance_homogeneity":brown_forsythe(&[a.clone(),b.clone()])})};
            Ok(json!({"n_a":a.len(),"n_b":b.len(),"mean_a":stats::mean(&a,None),"mean_b":stats::mean(&b,None),"difference":difference,"standard_error":se,"t":t,"df":df,"p_value":2.0*inference::student_t_cdf(-t.abs(),df),"diagnostics":diagnostic}))
        }
        "anova" => {
            let groups: Vec<Vec<f64>> = body["groups"].as_array().ok_or("Select at least two groups")?.iter().map(sample).collect::<Result<_,_>>()?;
            if groups.len()<2 || groups.iter().any(|g|g.len()<2) { return Err("ANOVA requires at least two groups with two observations each".into()); }
            let n:usize=groups.iter().map(Vec::len).sum(); let k=groups.len();
            let overall=groups.iter().flatten().sum::<f64>()/n as f64;
            let between=groups.iter().map(|g|g.len() as f64*(stats::mean(g,None)-overall).powi(2)).sum::<f64>();
            let within=groups.iter().map(|g|{let m=stats::mean(g,None);g.iter().map(|x|(x-m).powi(2)).sum::<f64>()}).sum::<f64>();
            let df1=(k-1) as f64; let df2=(n-k) as f64;
            if within <= 0.0 { return Err("ANOVA is undefined when within-group variation is zero".into()); }
            let f=(between/df1)/(within/df2);
            let p=inference::regularized_beta(df2/2.0,df1/2.0,df2/(df2+df1*f));
            let residuals:Vec<_>=groups.iter().flat_map(|g|{let m=stats::mean(g,None);g.iter().map(move |x|x-m)}).collect();
            Ok(json!({"n":n,"groups":k,"f":f,"df_between":df1,"df_within":df2,"p_value":p,"eta_squared":between/(between+within),"group_summaries":groups.iter().map(|g|json!({"n":g.len(),"mean":stats::mean(g,None),"sd":stats::std(g,None,1)})).collect::<Vec<_>>(),"post_hoc":pairwise(&groups),"diagnostics":{"residual_normality":jarque_bera(&residuals),"variance_homogeneity":brown_forsythe(&groups)}}))
        }
        _ => Err("Unknown dataset test".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_group_tests_and_invalid_cases() {
        let result=calculate(&json!({"test":"paired","a":[2,4,6,8],"b":[1,2,3,4]})).unwrap();
        assert!((result["t"].as_f64().unwrap()-3.872983346).abs()<1e-6);
        let result=calculate(&json!({"test":"anova","groups":[[1,2,3],[4,5,6],[7,8,9]]})).unwrap();
        assert!((result["f"].as_f64().unwrap()-27.0).abs()<1e-10);
        assert!((result["p_value"].as_f64().unwrap()-0.001).abs()<1e-10);
        let welch=calculate(&json!({"test":"welch","a":[1,2,3,4],"b":[4,6,8,10]})).unwrap();
        assert!((welch["p_value"].as_f64().unwrap()-0.031170456273481868).abs()<1e-9);
        assert!((welch["diagnostics"]["variance_homogeneity"]["p_value"].as_f64().unwrap()-0.17230829673040016).abs()<1e-9);
        assert_eq!(result["post_hoc"].as_array().unwrap().len(),3);
        for item in result["post_hoc"].as_array().unwrap() { assert!(item["adjusted_p_value"].as_f64().unwrap() >= item["p_value"].as_f64().unwrap()); }
        let normal=calculate(&json!({"test":"normality","values":[1,2,3,4,5,6,7,20]})).unwrap();
        assert!((normal["p_value"].as_f64().unwrap()-0.06338005552026146).abs()<1e-10);
        assert!((normal["shapiro_wilk"]["statistic"].as_f64().unwrap()-0.740402770673).abs()<1e-8);
        assert!((normal["shapiro_wilk"]["p_value"].as_f64().unwrap()-0.006393729455).abs()<1e-8);
        assert!((normal["lilliefors"]["statistic"].as_f64().unwrap()-0.308816167389).abs()<1e-8);
        assert!((normal["lilliefors"]["p_value"].as_f64().unwrap()-0.023768919415).abs()<1e-8);
        let short=calculate(&json!({"test":"normality","values":[1,2,4]})).unwrap();
        assert!(short["shapiro_wilk"]["statistic"].is_number());
        assert!(short["lilliefors"].is_null() && short["p_value"].is_null());
        let group=json!([0,0,0,0,0,1,1,1,1,1,2,2,2,2,2]);
        let x=json!([1,2,3,4,5,2,3,4,5,6,1,3,5,7,9]);
        let y=json!([1,3,2,5,4,4,3,7,6,8,5,7,8,10,9]);
        let z=json!([2,5,4,4,7,3,8,5,10,9,4,8,11,12,10]);
        let ancova=calculate(&json!({"test":"ancova","outcomes":[y],"covariates":[x],"group_codes":group})).unwrap();
        assert!((ancova["f"].as_f64().unwrap()-9.9877).abs()<0.001);
        assert!((ancova["diagnostics"]["group_by_covariate_interaction"]["statistic"].as_f64().unwrap()-1.0197).abs()<0.001);
        let manova=calculate(&json!({"test":"manova","outcomes":[y,z],"covariates":[],"group_codes":group})).unwrap();
        assert!((manova["wilks_lambda"].as_f64().unwrap()-0.41967).abs()<0.0001);
        assert!((manova["approximate_f"].as_f64().unwrap()-2.99).abs()<0.01);
        let mancova=calculate(&json!({"test":"mancova","outcomes":[y,z],"covariates":[x],"group_codes":group})).unwrap();
        assert!((mancova["wilks_lambda"].as_f64().unwrap()-0.30108).abs()<0.0001);
        assert!((mancova["approximate_f"].as_f64().unwrap()-4.112).abs()<0.01);
        assert_eq!(ancova["adjusted_comparisons"].as_array().unwrap().len(),3);
        assert!((ancova["adjusted_comparisons"][0]["difference"].as_f64().unwrap()+1.9166666667).abs()<1e-8);
        assert!((ancova["adjusted_comparisons"][0]["p_value"].as_f64().unwrap()-0.023259002).abs()<1e-8);
        let fa=json!([0,0,0,0,0,0,1,1,1,1,1,1]);
        let fb=json!([0,0,0,1,1,1,0,0,0,1,1,1]);
        let fy=json!([1,2,4,3,6,5,4,3,6,7,9,8]);
        let fz=json!([3,1,4,4,8,5,5,7,4,6,11,9]);
        let factorial=calculate(&json!({"test":"factorial","outcomes":[fy],"covariates":[],"group_codes":fa,"group2_codes":fb,"interaction":true})).unwrap();
        assert!((factorial["terms"][0]["f"].as_f64().unwrap()-10.6667).abs()<0.001);
        assert!((factorial["terms"][1]["f"].as_f64().unwrap()-13.5).abs()<0.001);
        assert!((factorial["terms"][2]["f"].as_f64().unwrap()-0.6667).abs()<0.001);
        assert!((factorial["adjusted_comparisons"][0]["difference"].as_f64().unwrap()+2.6666666667).abs()<1e-8);
        let mf=calculate(&json!({"test":"factorial","outcomes":[fy,fz],"covariates":[],"group_codes":fa,"group2_codes":fb,"interaction":true})).unwrap();
        assert!((mf["terms"][0]["wilks_lambda"].as_f64().unwrap()-0.39121).abs()<0.0001);
        assert!((mf["terms"][2]["f"].as_f64().unwrap()-0.307).abs()<0.001);
        let unbalanced=calculate(&json!({"test":"factorial","outcomes":[[1,4,3,6,5,4,3,6,7,9,8]],"covariates":[],"group_codes":[0,0,0,0,0,1,1,1,1,1,1],"group2_codes":[0,0,1,1,1,0,0,0,1,1,1],"interaction":true})).unwrap();
        assert!((unbalanced["terms"][0]["f"].as_f64().unwrap()-7.8678).abs()<0.001);
        assert!((unbalanced["terms"][1]["f"].as_f64().unwrap()-10.0292).abs()<0.001);
        assert!(calculate(&json!({"test":"factorial","outcomes":[[1,2,3,4,5,6]],"covariates":[],"group_codes":[0,0,0,1,1,1],"group2_codes":[0,0,0,1,1,1],"interaction":true})).is_err());
        assert!(calculate(&json!({"test":"normality","values":[1,1,1,1,1,1,1,1]})).is_err());
        assert!(calculate(&json!({"test":"paired","a":[1,2],"b":[1,2,3]})).is_err());
    }
}
