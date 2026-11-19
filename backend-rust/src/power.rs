//! Regression power and discrete minimum sample sizes, without SciPy runtime.
use crate::{inference, model};
use serde::Deserialize;
use serde_json::{json, Value};

extern "C" { fn lgamma(x: f64) -> f64; }

fn critical_t(df: f64, tail_probability: f64) -> f64 {
    let mut low=0.0; let mut high=1.0;
    while inference::student_t_cdf(-high,df)>tail_probability && high<1e12 {high*=2.0;}
    for _ in 0..80 { let mid=(low+high)/2.0; if inference::student_t_cdf(-mid,df)>tail_probability {low=mid} else {high=mid} }
    (low+high)/2.0
}

// Integrate the noncentral-t tail over the square root of a chi-square variate.
fn one_sided_t_power(df: f64, noncentrality: f64, alpha: f64) -> f64 {
    let t=critical_t(df,alpha);
    let root=df.sqrt();
    let lo=(root-14.0).max(0.0); let hi=(root+14.0).max(16.0);
    let count=1024; let step=(hi-lo)/count as f64;
    let log_norm=-(df/2.0)*std::f64::consts::LN_2-unsafe{lgamma(df/2.0)}+std::f64::consts::LN_2;
    let integrand=|w:f64| {
        let density=if w==0.0 { if df==1.0 {log_norm.exp()} else {0.0} } else {(log_norm+(df-1.0)*w.ln()-w*w/2.0).exp()};
        density*inference::normal_cdf(noncentrality-t*w/root)
    };
    let mut sum=integrand(lo)+integrand(hi);
    for i in 1..count {sum+=if i%2==0 {2.0}else{4.0}*integrand(lo+i as f64*step);}
    (sum*step/3.0).clamp(0.0,1.0)
}

fn chi_square_tail(x: f64, df: f64, lambda: f64) -> Result<f64, String> {
    let mu=lambda/2.0;
    if !mu.is_finite() || mu>10_000_000.0 {return Err("Noncentrality exceeds the supported range".into());}
    let mode=mu.floor() as usize;
    let tail=|j:usize| statrs::function::gamma::gamma_ur(df/2.0+j as f64,x/2.0);
    let mut mass=1.0; let mut weighted=tail(mode);
    let mut weight=1.0;
    for j in (1..=mode).rev() {
        weight*=j as f64/mu;
        mass+=weight; weighted+=weight*tail(j-1);
        if weight<1e-15 {break;}
    }
    weight=1.0;
    for j in mode+1..mode+1_000_000 {
        weight*=mu/j as f64;
        mass+=weight; weighted+=weight*tail(j);
        if weight<1e-15 {break;}
    }
    if !weighted.is_finite() || !mass.is_finite() {return Err("Could not evaluate the chi-square power".into());}
    Ok((weighted/mass).clamp(0.0,1.0))
}

fn chi_square_critical(df:f64, alpha:f64) -> Result<f64,String> {
    let mut low=0.0;let mut high=df.max(1.0);
    while statrs::function::gamma::gamma_ur(df/2.0,high/2.0)>alpha {high*=2.0;if high>1e12{return Err("Could not determine the chi-square critical value".into());}}
    for _ in 0..80 {let mid=(low+high)/2.0;if statrs::function::gamma::gamma_ur(df/2.0,mid/2.0)>alpha {low=mid}else{high=mid}}
    Ok((low+high)/2.0)
}

/// A priori sample size for supported two-sided tests and omnibus F tests.
pub fn plan(body: &Value) -> Result<Value, String> {
    let test=body["test"].as_str().ok_or("Choose a statistical test")?;
    let effect=body["effect_size"].as_f64().ok_or("Enter an effect size")?;
    let alpha=body["alpha"].as_f64().unwrap_or(0.05);
    let target=body["power"].as_f64().unwrap_or(0.8);
    if !effect.is_finite() || effect<=0.0 || effect>10.0 {return Err("Effect size must be greater than zero and at most 10".into());}
    if !(0.0..0.5).contains(&alpha) || !(0.0..1.0).contains(&target) || alpha==0.0 || target==0.0 {return Err("Alpha must be between 0 and 0.5 and target power between 0 and 1".into());}
    let predictors=if body["predictors"].is_null() {1} else {body["predictors"].as_u64().ok_or("Predictors must be a whole number")? as usize};
    let tested=if body["tested_predictors"].is_null() {predictors} else {body["tested_predictors"].as_u64().ok_or("Tested predictors must be a whole number")? as usize};
    let groups=if body["groups"].is_null() {2} else {body["groups"].as_u64().ok_or("Groups must be a whole number")? as usize};
    let ratio=body["allocation_ratio"].as_f64().unwrap_or(1.0);
    let chi_df=if body["degrees_of_freedom"].is_null() {1} else {body["degrees_of_freedom"].as_u64().ok_or("Degrees of freedom must be a whole number")? as usize};
    let tails=body["tails"].as_str().unwrap_or("two");
    if !["one","two"].contains(&tails) {return Err("Choose one- or two-sided testing".into());}
    if test=="regression" && !(1..=100).contains(&predictors) {return Err("Choose between 1 and 100 predictors".into());}
    if test=="regression" && (tested==0 || tested>predictors) {return Err("Tested predictors must be between 1 and the total number of predictors".into());}
    if test=="anova" && !(2..=50).contains(&groups) {return Err("Choose between 2 and 50 groups".into());}
    if ["independent_t","independent_z"].contains(&test) && (!ratio.is_finite() || !(0.1..=10.0).contains(&ratio)) {return Err("Allocation ratio must be between 0.1 and 10".into());}
    if test=="chi_square" && !(1..=100).contains(&chi_df) {return Err("Choose between 1 and 100 degrees of freedom".into());}
    let chi_critical=if test=="chi_square" {Some(chi_square_critical(chi_df as f64,alpha)?)}else{None};
    let calculate=|unit:usize| -> Result<(f64,usize,usize,f64,f64,f64),String> {
        let (n1,n2,df1,df2,lambda)=match test {
            "one_sample_t" | "paired_t" => (unit,0,1.0,(unit-1) as f64,effect*effect*unit as f64),
            "independent_t" => {let second=((unit as f64)*ratio).ceil() as usize; (unit,second,1.0,(unit+second-2) as f64,effect*effect*(unit as f64)*(second as f64)/((unit+second) as f64))},
            "independent_z" => {let second=((unit as f64)*ratio).ceil() as usize; (unit,second,0.0,0.0,effect*effect*(unit as f64)*(second as f64)/((unit+second) as f64))},
            "one_sample_z" => (unit,0,0.0,0.0,effect*effect*unit as f64),
            "chi_square" => (unit,0,chi_df as f64,0.0,effect*effect*unit as f64),
            "anova" => {let n=unit*groups;(n,0,(groups-1) as f64,(n-groups) as f64,effect*effect*n as f64)},
            "regression" => (unit,0,tested as f64,(unit-predictors-1) as f64,effect*unit as f64),
            _ => return Err("This test is not yet supported".into()),
        };
        let power=if test=="chi_square" {chi_square_tail(chi_critical.unwrap(),df1,lambda)?}
        else if ["one_sample_z","independent_z"].contains(&test) {
            let crit=inference::normal_ppf(1.0-if tails=="one"{alpha}else{alpha/2.0});
            inference::normal_cdf(lambda.sqrt()-crit)+if tails=="two"{inference::normal_cdf(-lambda.sqrt()-crit)}else{0.0}
        } else if tails=="one" && ["one_sample_t","paired_t","independent_t"].contains(&test) {
            one_sided_t_power(df2,lambda.sqrt(),alpha)
        } else {inference::regression_power(df1,df2,lambda,alpha)?};
        Ok((power,n1,n2,df1,df2,lambda))
    };
    let minimum=match test {"one_sample_t" | "paired_t" | "anova" | "one_sample_z" | "chi_square"=>2,"independent_t" | "independent_z" => 2usize.max((2.0/ratio).ceil() as usize),"regression"=>predictors+2,_=>return Err("This test is not yet supported".into())};
    let mut high=minimum;
    while calculate(high)?.0 < target {
        if high >= 1_000_000 {return Err("Required sample size exceeds the supported search limit".into());}
        high=(high*2).min(1_000_000);
    }
    let mut low=minimum;
    while low<high {let mid=low+(high-low)/2;if calculate(mid)?.0>=target {high=mid}else{low=mid+1}}
    let (achieved,n1,n2,df1,df2,lambda)=calculate(low)?;
    let is_z=["one_sample_z","independent_z"].contains(&test);
    let mut left=0.0;let mut right=1.0;
    if !is_z && test!="chi_square" {
        while inference::noncentral_f_cdf(right,df1,df2,0.0)? < 1.0-alpha {right*=2.0;if right>1e12{return Err("Could not determine the critical value".into());}}
        for _ in 0..80 {let mid=(left+right)/2.0;if inference::noncentral_f_cdf(mid,df1,df2,0.0)?<1.0-alpha{left=mid}else{right=mid}}
    }
    let critical_f=if !is_z && test!="chi_square" {Some((left+right)/2.0)}else{None};
    let is_t=["one_sample_t","paired_t","independent_t"].contains(&test);
    let mut curve=Vec::new();
    let mut last=0;
    for percent in [50usize,65,80,90,100,110,125,140,160] {
        let unit=(low.saturating_mul(percent)/100).max(minimum).min(1_000_000);
        if unit<=last {continue;}
        let (p,a,b,_,_,_)=calculate(unit)?;
        curve.push(json!({"sample_size":a+b,"power":p})); last=unit;
    }
    Ok(json!({"test":test,"tails":if is_t || is_z {tails}else{"upper"},"sample_size":n1+n2,"group_1":if ["independent_t","independent_z"].contains(&test){Some(n1)}else{None},"group_2":if ["independent_t","independent_z"].contains(&test){Some(n2)}else{None},"per_group":if test=="anova"{Some(low)}else{None},"achieved_power":achieved,"target_power":target,"alpha":alpha,"effect_size":effect,"df1":df1,"df2":df2,"critical_f":if is_t && tails=="one" {None}else{critical_f},"critical_t":if is_t {Some(if tails=="one" {critical_t(df2,alpha)}else{critical_f.unwrap().sqrt()})} else {None},"critical_z":if is_z {Some(inference::normal_ppf(1.0-if tails=="one"{alpha}else{alpha/2.0}))} else {None},"critical_chi_square":chi_critical,"noncentrality":if is_t || is_z {lambda.sqrt()} else {lambda},"curve":curve}))
}

#[cfg(test)]
mod plan_tests {
    use super::*;
    #[test]
    fn a_priori_matches_reference_values_and_checks_bounds() {
        let paired=plan(&json!({"test":"paired_t","effect_size":0.5,"alpha":0.05,"power":0.8})).unwrap();
        assert_eq!(paired["sample_size"],34);
        let independent=plan(&json!({"test":"independent_t","effect_size":0.5,"alpha":0.05,"power":0.8,"allocation_ratio":1.0})).unwrap();
        assert_eq!(independent["group_1"],64);
        assert_eq!(independent["group_2"],64);
        let one_sided=plan(&json!({"test":"paired_t","effect_size":0.5,"alpha":0.05,"power":0.8,"tails":"one"})).unwrap();
        assert_eq!(one_sided["sample_size"],27);
        assert!((one_sided["achieved_power"].as_f64().unwrap()-0.8118316).abs()<1e-6);
        let independent_one=plan(&json!({"test":"independent_t","effect_size":0.5,"alpha":0.05,"power":0.8,"tails":"one"})).unwrap();
        assert_eq!(independent_one["group_1"],51);
        assert!((independent_one["achieved_power"].as_f64().unwrap()-0.8058986).abs()<1e-6);
        let anova=plan(&json!({"test":"anova","effect_size":0.25,"alpha":0.05,"power":0.8,"groups":3})).unwrap();
        assert_eq!(anova["per_group"],53);
        let regression=plan(&json!({"test":"regression","effect_size":0.15,"alpha":0.05,"power":0.8,"predictors":3})).unwrap();
        assert_eq!(regression["sample_size"],77);
        let incremental=plan(&json!({"test":"regression","effect_size":0.15,"alpha":0.05,"power":0.8,"predictors":5,"tested_predictors":2})).unwrap();
        assert_eq!(incremental["sample_size"],68);
        let z=plan(&json!({"test":"independent_z","effect_size":0.5,"alpha":0.05,"power":0.8})).unwrap();
        assert_eq!(z["group_1"],63);
        let chi=plan(&json!({"test":"chi_square","effect_size":0.3,"alpha":0.05,"power":0.8,"degrees_of_freedom":2})).unwrap();
        assert_eq!(chi["sample_size"],108);
        assert!((chi["achieved_power"].as_f64().unwrap()-0.803693898199823).abs()<1e-9);
        let unequal=plan(&json!({"test":"independent_t","effect_size":0.4,"alpha":0.05,"power":0.9,"allocation_ratio":1.5})).unwrap();
        assert_eq!(unequal["group_1"],111);
        assert_eq!(unequal["group_2"],167);
        assert!(plan(&json!({"test":"paired_t","effect_size":0,"alpha":0.05,"power":0.8})).is_err());
        assert!(plan(&json!({"test":"regression","effect_size":0.15,"predictors":0})).is_err());
    }
}

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Options {
    pub n_samples: usize,
    pub n_predictors: usize,
    pub r_squared: Option<f64>,
    pub effect_size_f2: Option<f64>,
    pub alpha: f64,
    pub target_power: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            n_samples: 100,
            n_predictors: 1,
            r_squared: None,
            effect_size_f2: None,
            alpha: 0.05,
            target_power: 0.80,
        }
    }
}
pub fn compute(o: &Options) -> Result<f64, String> {
    let f2 = if let Some(f2) = o.effect_size_f2 {
        f2.max(1e-4)
    } else {
        let Some(r2) = o.r_squared.filter(|r2| *r2 > 0.0) else {
            return Ok(0.0);
        };
        let r2 = r2.clamp(0.001, 0.999);
        r2 / (1.0 - r2)
    };
    let u = o.n_predictors.max(1);
    let v = o.n_samples.saturating_sub(u.saturating_add(1)).max(1);
    inference::regression_power(u as f64, v as f64, f2 * o.n_samples as f64, o.alpha)
}
pub fn minimum(o: &Options) -> Result<usize, String> {
    let mut opts = o.clone();
    opts.n_predictors = opts.n_predictors.max(1);
    if opts.effect_size_f2.is_none() {
        let r2 = opts.r_squared.unwrap_or(0.25).clamp(0.001, 0.999);
        opts.effect_size_f2 = Some(r2 / (1.0 - r2));
    }
    let mut low = opts.n_predictors.saturating_add(5);
    let mut high = 5000;
    opts.n_samples = high;
    if compute(&opts)? < o.target_power {
        return Ok(high);
    }
    while low < high {
        let mid = (low + high) / 2;
        opts.n_samples = mid;
        if compute(&opts)? >= o.target_power {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    Ok(low.min(5000))
}
pub fn ten_times(formative: usize, paths: usize) -> Value {
    let formative = formative.max(1);
    let paths = paths.max(1);
    json!({"ten_times_rule_min_n":10*formative.max(paths),"max_formative_indicators":formative,"max_paths_into_construct":paths,
        "inverse_square_root_method":{"min_path_0_10":(2.486_f64/0.10).powi(2).ceil() as usize,"min_path_0_20":(2.486_f64/0.20).powi(2).ceil() as usize},
        "note":"The 10-times rule is a rough rule of thumb. Modern recommendations favor power analyses based on noncentral F distributions or the inverse square root method (Hair et al. 2017; Kock & Hadaya 2018)."})
}
pub fn table(alpha: f64, target: f64) -> Result<Value, String> {
    let mut rows = Vec::new();
    for predictors in 1..=10 {
        let mut row = json!({"predictors":predictors});
        for r2 in [0.10, 0.25, 0.50, 0.75] {
            row[format!("r2_{}", (r2 * 100.0) as usize)] = json!(minimum(&Options {
                n_predictors: predictors,
                r_squared: Some(r2),
                alpha,
                target_power: target,
                ..Options::default()
            })?);
        }
        rows.push(row);
    }
    Ok(
        json!({"target_power":target,"significance_level":alpha,"table":rows,"reference":"Hair, Hult, Ringle, Sarstedt (2017) Appendix C & Cohen (1992)."}),
    )
}
pub fn evaluate(samples: usize, spec: Value, r2: Value, alpha: f64) -> Result<Value, String> {
    let mut targets: Vec<(String, Vec<String>)> = Vec::new();
    for path in spec["paths"].as_array().into_iter().flatten() {
        let source = model::alias(path, &["from", "from_node"]).unwrap_or("None");
        let target = model::alias(path, &["to", "to_node"]).unwrap_or("None");
        if let Some((_, preds)) = targets.iter_mut().find(|(id, _)| id == target) {
            preds.push(source.into());
        } else {
            targets.push((target.into(), vec![source.into()]));
        }
    }
    let mut evaluations = Vec::new();
    let mut all = true;
    for (target, preds) in targets {
        let o = Options {
            n_samples: samples,
            n_predictors: preds.len(),
            r_squared: Some(0.25),
            alpha,
            ..Options::default()
        };
        let benchmark = compute(&o)?;
        let required = minimum(&o)?;
        let observed = r2[&target].as_f64();
        let observed_power = if let Some(r2) = observed.filter(|r2| *r2 > 0.0) {
            Some(compute(&Options {
                r_squared: Some(r2),
                ..o
            })?)
        } else {
            None
        };
        let adequate = observed_power.unwrap_or(benchmark) >= 0.80;
        all &= adequate;
        evaluations.push(json!({"endogenous_construct":target,"n_predictors":preds.len(),"predictors":preds,"observed_r_squared":observed,"observed_power":observed_power,"power_at_benchmark_r2_0_25":benchmark,"n_required_for_power_80_percent":required,"has_adequate_power":adequate}));
    }
    Ok(
        json!({"n_samples":samples,"alpha":alpha,"construct_evaluations":evaluations,"general_adequate":all}),
    )
}
