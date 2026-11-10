//! Native .pls metadata, model, result and snapshot storage.
//! Legacy dataset conversion is a separate gate; unsupported legacy schemas
//! are rejected before modification rather than silently losing datasets.
use crate::{python_json, sqlite::Connection};
use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

/// Return the current user's home directory across Unix/macOS and Windows.
pub fn user_home_dir() -> Result<PathBuf, String> {
    if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(home));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(profile));
    }
    if let (Some(drive), Some(path)) = (
        std::env::var_os("HOMEDRIVE").filter(|v| !v.is_empty()),
        std::env::var_os("HOMEPATH").filter(|v| !v.is_empty()),
    ) {
        let mut combined = PathBuf::from(drive);
        combined.push(path);
        return Ok(combined);
    }
    Err("Home directory is unavailable".into())
}

fn strip_windows_verbatim(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

/// Canonicalize an existing path, or canonicalize its deepest existing ancestor
/// and lexically normalize any not-yet-created trailing segments.
pub fn canonicalize_or_normalize(path: &Path) -> PathBuf {
    if path.exists() {
        if let Ok(canon) = fs::canonicalize(path) {
            return strip_windows_verbatim(canon);
        }
    }

    let mut existing_ancestor: Option<PathBuf> = None;
    let mut missing_parts: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = Some(path);
    while let Some(curr) = cursor {
        if curr.exists() {
            existing_ancestor = Some(curr.to_path_buf());
            break;
        }
        if let Some(name) = curr.file_name() {
            missing_parts.push(name.to_os_string());
        }
        cursor = curr.parent();
    }

    let mut base = match existing_ancestor {
        Some(ancestor) => fs::canonicalize(&ancestor)
            .map(strip_windows_verbatim)
            .unwrap_or(ancestor),
        None => std::env::current_dir().unwrap_or_default(),
    };

    for part in missing_parts.into_iter().rev() {
        let part_path = Path::new(&part);
        if matches!(part_path.components().next(), Some(Component::ParentDir)) {
            base.pop();
        } else if !matches!(part_path.components().next(), Some(Component::CurDir)) {
            base.push(part);
        }
    }
    base
}

fn extract_src_tauri_tilde_tail(raw: &str) -> Option<&str> {
    for marker in ["/src-tauri/~/", r"\src-tauri\~\", "src-tauri/~/", r"src-tauri\~\"] {
        if let Some(idx) = raw.find(marker) {
            let tail = &raw[idx + marker.len()..];
            return Some(tail.trim_start_matches(['/', '\\']));
        }
    }
    None
}

fn expand_tilde_only(raw: &str) -> Result<(PathBuf, Option<String>), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Path is required".into());
    }
    if trimmed == "~" {
        return Ok((user_home_dir()?, Some(String::new())));
    }
    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        let clean_rest = rest.trim_start_matches(['/', '\\']);
        let home = user_home_dir()?;
        let expanded = if clean_rest.is_empty() {
            home
        } else {
            home.join(clean_rest)
        };
        return Ok((expanded, Some(clean_rest.to_string())));
    }
    if let Some(clean_rest) = extract_src_tauri_tilde_tail(trimmed) {
        let home = user_home_dir()?;
        let expanded = if clean_rest.is_empty() {
            home
        } else {
            home.join(clean_rest)
        };
        return Ok((expanded, Some(clean_rest.to_string())));
    }
    let path = PathBuf::from(trimmed);
    if path.is_relative() {
        let abs = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(&path);
        return Ok((abs, None));
    }
    Ok((path, None))
}

fn copy_dir_without_journals(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.ends_with(".pls-journal")
            || name_str.ends_with(".pls-wal")
            || name_str.ends_with(".pls-shm")
        {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if file_type.is_dir() {
            copy_dir_without_journals(&from, &to)?;
        } else if file_type.is_file() && !to.exists() {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Non-destructively copy legacy `src-tauri/~/...` or `<cwd>/~/...` data to the
/// resolved `$HOME/...` location if the resolved target does not exist yet.
/// Existing `~/` sources are intentionally preserved so verification comes first.
pub fn migrate_legacy_tilde_if_needed(raw: &str, resolved: &Path) {
    if resolved.exists() {
        return;
    }
    let raw_trimmed = raw.trim();
    let mut legacy_candidates: Vec<PathBuf> = Vec::new();
    if let Some((_, Some(tail))) = expand_tilde_only(raw_trimmed).ok() {
        if !tail.is_empty() {
            if let Ok(cwd) = std::env::current_dir() {
                legacy_candidates.push(cwd.join("~").join(&tail));
                legacy_candidates.push(cwd.join("src-tauri").join("~").join(&tail));
            }
        }
    }
    let raw_path = PathBuf::from(raw_trimmed);
    if extract_src_tauri_tilde_tail(raw_trimmed).is_some() && raw_path.exists() {
        legacy_candidates.push(raw_path);
    }

    for legacy in legacy_candidates {
        if legacy == resolved || !legacy.exists() {
            continue;
        }
        if legacy.is_dir() {
            let _ = copy_dir_without_journals(&legacy, resolved);
            break;
        } else if legacy.is_file() {
            if let Some(parent) = resolved.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if fs::copy(&legacy, resolved).is_ok() {
                break;
            }
        }
    }
}

/// Expand leading `~` (and legacy `src-tauri/~/`) to the OS home directory and
/// return a canonicalized path without modifying or deleting legacy directories.
pub fn resolve_user_path(raw: &str) -> Result<PathBuf, String> {
    let (expanded, _) = expand_tilde_only(raw)?;
    let resolved = canonicalize_or_normalize(&expanded);
    migrate_legacy_tilde_if_needed(raw, &resolved);
    Ok(canonicalize_or_normalize(&resolved))
}

pub struct Store {
    path: PathBuf,
    fixed_time: Option<String>,
}
impl Store {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        let input = path.into();
        let resolved = input
            .to_str()
            .and_then(|s| resolve_user_path(s).ok())
            .unwrap_or_else(|| canonicalize_or_normalize(&input));
        Self {
            path: resolved,
            fixed_time: None,
        }
    }
    pub fn with_timestamp(path: impl Into<PathBuf>, timestamp: String) -> Self {
        let input = path.into();
        let resolved = input
            .to_str()
            .and_then(|s| resolve_user_path(s).ok())
            .unwrap_or_else(|| canonicalize_or_normalize(&input));
        Self {
            path: resolved,
            fixed_time: Some(timestamp),
        }
    }
    fn now(&self) -> String {
        self.fixed_time
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false))
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    fn ensure_resolved_path(&self) -> Result<(), String> {
        if self
            .path
            .components()
            .any(|c| matches!(c, Component::Normal(part) if part == "~"))
        {
            return Err(format!(
                "Unexpanded '~' directory component is not permitted in path: {}",
                self.path.display()
            ));
        }
        Ok(())
    }
    fn connect(&self) -> Result<Connection, String> {
        self.ensure_resolved_path()?;
        if !self.path.exists() {
            return Err(format!("Project not found: {}", self.path.display()));
        }
        let db = Connection::open(&self.path, false)?;
        schema(&db)?;
        Ok(db)
    }
    pub fn create(&self, name: &str) -> Result<Value, String> {
        self.ensure_resolved_path()?;
        if self.path.exists() {
            return Err("Project file already exists".into());
        }
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&self.path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    "Project file already exists".into()
                } else {
                    e.to_string()
                }
            })?;
        drop(file);
        let result = (|| {
            let db = Connection::open(&self.path, false)?;
            schema(&db)?;
            let tx = db.transaction()?;
            let now = self.now();
            for (key, value) in [
                ("name", name),
                ("created_at", now.as_str()),
                ("modified_at", now.as_str()),
                ("schema_version", "2.0"),
            ] {
                db.execute(
                    "INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)",
                    &[json!(key), json!(value)],
                )?;
            }
            db.execute("INSERT INTO model_spec(spec_json,diagram_layout_json,updated_at,model_key) VALUES (?,NULL,?,'default')",&[json!("{\"constructs\": [], \"indicators\": [], \"paths\": []}"),json!(now)])?;
            tx.commit()?;
            Ok(Value::Null)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&self.path);
        }
        result
    }
    pub fn metadata(&self) -> Result<Value, String> {
        let db = self.connect()?;
        Ok(Value::Object(
            db.query("SELECT key,value FROM metadata", &[])?
                .into_iter()
                .map(|row| (row[0].as_str().unwrap().to_owned(), row[1].clone()))
                .collect(),
        ))
    }
    pub fn save_model(
        &self,
        spec: &Value,
        layout: &Value,
        key: Option<&str>,
    ) -> Result<Value, String> {
        let db = self.connect()?;
        let tx = db.transaction()?;
        let now = self.now();
        let key = key.filter(|s| !s.is_empty()).unwrap_or("default");
        let old = db.query("SELECT id FROM model_spec WHERE model_key=?", &[json!(key)])?;
        if let Some(row) = old.first() {
            db.execute(
                "UPDATE model_spec SET spec_json=?,diagram_layout_json=?,updated_at=? WHERE id=?",
                &[
                    encoded(spec),
                    optional_json(layout),
                    json!(now),
                    row[0].clone(),
                ],
            )?;
        } else {
            db.execute("INSERT INTO model_spec(spec_json,diagram_layout_json,updated_at,model_key) VALUES (?,?,?,?)",&[encoded(spec),optional_json(layout),json!(now),json!(key)])?;
        }
        modified(&db, &now)?;
        tx.commit()?;
        Ok(Value::Null)
    }
    pub fn load_model(&self, key: Option<&str>) -> Result<Value, String> {
        if !self.path.exists() {
            return Ok(Value::Null);
        }
        let db = self.connect()?;
        let key = key.filter(|s| !s.is_empty());
        let mut rows=db.query("SELECT spec_json,diagram_layout_json,updated_at,model_key FROM model_spec WHERE model_key=?",&[json!(key.unwrap_or("default"))])?;
        if rows.is_empty() && key.is_none() {
            rows=db.query("SELECT spec_json,diagram_layout_json,updated_at,model_key FROM model_spec ORDER BY id ASC LIMIT 1",&[])?;
        }
        let Some(row) = rows.first() else {
            return Ok(Value::Null);
        };
        Ok(
            json!({"spec":decoded(&row[0])?,"diagram_layout":decoded(&row[1])?,"updated_at":row[2],"model_key":row[3]}),
        )
    }
    pub fn rename_model(&self, key: &str, name: &str) -> Result<Value, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Model name cannot be empty".into());
        }
        let db = self.connect()?;
        let tx = db.transaction()?;
        let rows = db.query(
            "SELECT spec_json FROM model_spec WHERE model_key=?",
            &[json!(key)],
        )?;
        let Some(row) = rows.first() else {
            return Err(format!("Model '{key}' not found"));
        };
        let mut spec = decoded(&row[0])?;
        if spec.is_null() {
            spec = json!({});
        }
        spec.as_object_mut()
            .ok_or("Model spec must be an object")?
            .insert("name".into(), json!(name));
        let now = self.now();
        db.execute(
            "UPDATE model_spec SET spec_json=?,updated_at=? WHERE model_key=?",
            &[encoded(&spec), json!(now), json!(key)],
        )?;
        modified(&db, &now)?;
        tx.commit()?;
        Ok(json!({"status":"renamed","model_id":key,"new_name":name}))
    }
    pub fn save_results(&self, o: Results) -> Result<Value, String> {
        let db = self.connect()?;
        let tx = db.transaction()?;
        let now = self.now();
        let key = o
            .model_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("default");
        db.execute("DELETE FROM results WHERE algorithm=? AND model_key=? AND (analysis_type=? OR analysis_type IS NULL)",&[json!(o.algorithm),json!(key),json!(o.analysis_type)])?;
        db.execute("INSERT INTO results(algorithm,analysis_type,results_json,created_at,model_key,spec_json,diagram_layout_json,dataset_id,dataset_hash,spec_hash,params_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            &[json!(o.algorithm),json!(o.analysis_type),encoded(&o.results),json!(now),json!(key),optional_json(&o.spec),optional_json(&o.diagram_layout),json!(o.dataset_id),json!(o.dataset_hash),json!(python_json::spec_hash(&o.spec)),optional_json(&o.params)])?;
        modified(&db, &now)?;
        tx.commit()?;
        Ok(json!({"status":"saved","created_at":now}))
    }
    pub fn load_results(
        &self,
        algorithm: &str,
        key: Option<&str>,
        analysis: Option<&str>,
    ) -> Result<Value, String> {
        if !self.path.exists() {
            return Ok(Value::Null);
        }
        let key = key.filter(|s| !s.is_empty());
        let analysis = analysis.filter(|s| !s.is_empty());
        let db = self.connect()?;
        let select="SELECT algorithm,analysis_type,results_json,created_at,model_key,spec_json,diagram_layout_json,dataset_id,dataset_hash,spec_hash,params_json FROM results WHERE algorithm=?";
        let mut query = select.to_owned();
        let mut args = vec![json!(algorithm)];
        if let Some(key) = key {
            query.push_str(" AND model_key=?");
            args.push(json!(key));
        } else {
            query.push_str(" AND (model_key IS NULL OR model_key='' OR model_key='default')");
        }
        if let Some(analysis) = analysis {
            query.push_str(" AND analysis_type=?");
            args.push(json!(analysis));
        }
        query.push_str(" ORDER BY id DESC LIMIT 1");
        let mut rows = db.query(&query, &args)?;
        if rows.is_empty() && analysis.is_none() && key.is_none() {
            rows = db.query(
                &format!("{select} ORDER BY id DESC LIMIT 1"),
                &[json!(algorithm)],
            )?;
        }
        let Some(row) = rows.first() else {
            return Ok(Value::Null);
        };
        let current = self.load_model(key)?;
        let saved_hash = row[9].as_str().filter(|s| !s.is_empty());
        let stale = !current.is_null()
            && saved_hash.is_some_and(|s| s != python_json::spec_hash(&current["spec"]));
        Ok(
            json!({"algorithm":algorithm,"analysis_type":row[1],"results":decoded(&row[2])?,"created_at":row[3],"spec":decoded(&row[5])?,"diagram_layout":decoded(&row[6])?,"model_key":row[4],"dataset_id":row[7],"dataset_hash":row[8],"stale":stale,"params":decoded(&row[10])?}),
        )
    }
    pub fn save_snapshot(&self, o: Snapshot) -> Result<Value, String> {
        let db = self.connect()?;
        let tx = db.transaction()?;
        let id = o.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let now = self.now();
        db.execute("INSERT INTO snapshots(id,name,description,algorithm,results_json,model_spec_json,diagram_layout_json,created_at,source_model_id) VALUES (?,?,?,?,?,?,?,?,?)",
            &[json!(id),json!(o.name),json!(o.description),json!(o.algorithm),encoded(&o.results),encoded(&o.spec),encoded(&o.diagram_layout),json!(now),json!(o.source_model_id)])?;
        modified(&db, &now)?;
        tx.commit()?;
        Ok(
            json!({"id":id,"name":o.name,"description":o.description,"algorithm":o.algorithm,"created_at":now,"source_model_id":o.source_model_id}),
        )
    }
    pub fn list_snapshots(&self) -> Result<Value, String> {
        if !self.path.exists() {
            return Ok(json!([]));
        }
        let db = self.connect()?;
        Ok(json!(db.query("SELECT id,name,description,algorithm,created_at,source_model_id FROM snapshots ORDER BY created_at DESC",&[])?.into_iter().map(|r|json!({"id":r[0],"name":r[1],"description":r[2],"algorithm":r[3],"created_at":r[4],"source_model_id":r[5]})).collect::<Vec<_>>()))
    }
    pub fn snapshot(&self, id: &str) -> Result<Value, String> {
        if !self.path.exists() {
            return Ok(Value::Null);
        }
        let db = self.connect()?;
        let rows=db.query("SELECT id,name,description,algorithm,results_json,model_spec_json,diagram_layout_json,created_at,source_model_id FROM snapshots WHERE id=?",&[json!(id)])?;
        let Some(row) = rows.first() else {
            return Ok(Value::Null);
        };
        Ok(
            json!({"id":row[0],"name":row[1],"description":row[2],"algorithm":row[3],"results":decoded(&row[4])?,"spec":decoded(&row[5])?,"diagram_layout":decoded(&row[6])?,"created_at":row[7],"source_model_id":row[8]}),
        )
    }
    pub fn delete_snapshot(&self, id: &str) -> Result<Value, String> {
        if !self.path.exists() {
            return Ok(json!(false));
        }
        let db = self.connect()?;
        let tx = db.transaction()?;
        db.execute("DELETE FROM snapshots WHERE id=?", &[json!(id)])?;
        modified(&db, &self.now())?;
        tx.commit()?;
        Ok(json!(true))
    }
    pub fn model_from_snapshot(
        &self,
        snapshot: &str,
        id: &str,
        name: &str,
    ) -> Result<Value, String> {
        let snapshot = self.snapshot(snapshot)?;
        if snapshot.is_null() {
            return Err("Snapshot not found".into());
        }
        let mut spec = snapshot.get("spec").cloned().unwrap_or(json!({}));
        spec.as_object_mut()
            .ok_or("Snapshot model spec must be an object")?
            .insert("name".into(), json!(name));
        let layout = snapshot.get("diagram_layout").cloned().unwrap_or(json!({}));
        self.save_model(&spec, &layout, Some(id))?;
        if truth(&snapshot["results"]) {
            self.save_results(Results {
                model_id: Some(id.into()),
                algorithm: snapshot["algorithm"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("pls")
                    .into(),
                results: snapshot["results"].clone(),
                spec: spec.clone(),
                diagram_layout: layout.clone(),
                ..Results::default()
            })?;
        }
        Ok(
            json!({"status":"created","model_id":id,"name":name,"results":snapshot["results"],"diagram_layout":layout,"spec":spec}),
        )
    }
    pub fn duplicate_model(&self, source: &str, target: &str) -> Result<Value, String> {
        let mut model = self.load_model(Some(source))?;
        if model.is_null() {
            model = self.load_model(None)?;
        }
        let spec = model.get("spec").cloned().unwrap_or(json!({}));
        let layout = model.get("diagram_layout").cloned().unwrap_or(json!({}));
        self.save_model(&spec, &layout, Some(target))?;
        let old = self.load_results("pls", Some(source), None)?;
        if old.get("results").is_some_and(truth) {
            self.save_results(Results {
                model_id: Some(target.into()),
                algorithm: "pls".into(),
                results: old["results"].clone(),
                spec: old
                    .get("spec")
                    .filter(|v| truth(v))
                    .unwrap_or(&spec)
                    .clone(),
                diagram_layout: old
                    .get("diagram_layout")
                    .filter(|v| truth(v))
                    .unwrap_or(&layout)
                    .clone(),
                ..Results::default()
            })?;
        }
        Ok(json!({"status":"duplicated","model_id":target}))
    }
    pub fn save_dataset(&self, dataset: Dataset) -> Result<Value, String> {
        if dataset.columns.is_empty()
            || dataset
                .rows
                .iter()
                .any(|row| row.len() != dataset.columns.len())
        {
            return Err("Dataset columns and rows are inconsistent".into());
        }
        let db = self.connect()?;
        let tx = db.transaction()?;
        let now = self.now();
        let id = dataset.id.unwrap_or_else(|| "1".into());
        let values = json!({"columns":dataset.columns,"rows":dataset.rows});
        let hash = dataset_hash(&values);
        db.execute(
            "INSERT OR REPLACE INTO dataset_values(dataset_id,values_json) VALUES (?,?)",
            &[json!(id), encoded(&values)],
        )?;
        db.execute("INSERT OR REPLACE INTO datasets(id,name,parent_id,kind,derivation_json,n_rows,n_cols,hash,settings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,COALESCE((SELECT created_at FROM datasets WHERE id=?),?))",&[
            json!(id),json!(dataset.name),json!(dataset.parent_id),json!(dataset.kind),optional_json(&dataset.derivation),json!(values["rows"].as_array().unwrap().len()),json!(values["columns"].as_array().unwrap().len()),json!(hash),optional_json(&dataset.settings),json!(id),json!(now)])?;
        modified(&db, &now)?;
        tx.commit()?;
        Ok(
            json!({"status":"success","dataset_id":id,"dataset_name":dataset.name,"row_count":values["rows"].as_array().unwrap().len(),"n_rows":values["rows"].as_array().unwrap().len(),"column_count":values["columns"].as_array().unwrap().len(),"n_cols":values["columns"].as_array().unwrap().len(),"hash":hash}),
        )
    }
    pub fn dataset(&self, id: Option<&str>) -> Result<Value, String> {
        let db = self.connect()?;
        let id = id.unwrap_or("1");
        let rows=db.query("SELECT d.id,d.name,d.parent_id,d.kind,d.derivation_json,d.n_rows,d.n_cols,d.hash,d.settings_json,d.created_at,v.values_json FROM datasets d JOIN dataset_values v ON d.id=v.dataset_id WHERE d.id=?",&[json!(id)])?;
        let Some(row) = rows.first() else {
            return Ok(Value::Null);
        };
        let values = decoded(&row[10])?;
        Ok(
            json!({"id":row[0],"name":row[1],"dataset_name":row[1],"parent_id":row[2],"kind":row[3],"derivation":decoded(&row[4])?,"n_rows":row[5],"n_cols":row[6],"hash":row[7],"settings":decoded(&row[8])?,"created_at":row[9],"columns":values["columns"],"rows":values["rows"]}),
        )
    }
    pub fn datasets(&self) -> Result<Value, String> {
        let db = self.connect()?;
        Ok(json!(db.query("SELECT id,name,parent_id,kind,n_rows,n_cols,hash,created_at FROM datasets ORDER BY created_at ASC",&[])?.into_iter().map(|r|json!({"id":r[0],"name":r[1],"parent_id":r[2],"kind":r[3],"n_rows":r[4],"n_cols":r[5],"hash":r[6],"created_at":r[7]})).collect::<Vec<_>>()))
    }
    pub fn delete_dataset(&self, id: &str) -> Result<bool, String> {
        let db = self.connect()?;
        let tx = db.transaction()?;
        db.execute(
            "DELETE FROM dataset_values WHERE dataset_id=?",
            &[json!(id)],
        )?;
        db.execute(
            "DELETE FROM dataset_columns WHERE dataset_id=?",
            &[json!(id)],
        )?;
        db.execute("DELETE FROM datasets WHERE id=?", &[json!(id)])?;
        modified(&db, &self.now())?;
        tx.commit()?;
        Ok(true)
    }
}
fn truth(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}
fn encoded(v: &Value) -> Value {
    json!(serde_json::to_string(v).unwrap())
}
fn optional_json(v: &Value) -> Value {
    if v.is_null() {
        Value::Null
    } else {
        encoded(v)
    }
}
fn decoded(v: &Value) -> Result<Value, String> {
    v.as_str()
        .filter(|s| !s.is_empty())
        .map(|s| serde_json::from_str(s).map_err(|e| e.to_string()))
        .unwrap_or(Ok(Value::Null))
}
fn modified(db: &Connection, now: &str) -> Result<(), String> {
    db.execute(
        "UPDATE metadata SET value=? WHERE key='modified_at'",
        &[json!(now)],
    )?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(default)]
pub struct Results {
    pub algorithm: String,
    pub results: Value,
    pub model_id: Option<String>,
    pub spec: Value,
    pub diagram_layout: Value,
    pub analysis_type: String,
    pub dataset_id: Option<String>,
    pub dataset_hash: Option<String>,
    pub params: Value,
}
impl Default for Results {
    fn default() -> Self {
        Self {
            algorithm: "pls".into(),
            results: Value::Null,
            model_id: None,
            spec: Value::Null,
            diagram_layout: Value::Null,
            analysis_type: "pls".into(),
            dataset_id: None,
            dataset_hash: None,
            params: Value::Null,
        }
    }
}

#[derive(Deserialize)]
#[serde(default)]
pub struct Snapshot {
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    pub algorithm: String,
    pub results: Value,
    pub spec: Value,
    pub diagram_layout: Value,
    pub source_model_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(default)]
pub struct Dataset {
    pub id: Option<String>,
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub parent_id: Option<String>,
    pub kind: String,
    pub derivation: Value,
    pub settings: Value,
}
impl Default for Dataset {
    fn default() -> Self {
        Self {
            id: None,
            name: "Imported data".into(),
            columns: vec![],
            rows: vec![],
            parent_id: None,
            kind: "imported".into(),
            derivation: Value::Null,
            settings: Value::Null,
        }
    }
}
fn dataset_hash(values: &Value) -> String {
    let mut h = Sha256::new();
    h.update(serde_json::to_vec(values).unwrap());
    format!("{:x}", h.finalize())[..16].into()
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            id: None,
            name: String::new(),
            description: String::new(),
            algorithm: "pls".into(),
            results: Value::Null,
            spec: Value::Null,
            diagram_layout: Value::Null,
            source_model_id: None,
        }
    }
}

pub fn schema(db: &Connection) -> Result<(), String> {
    let existing = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='datasets'",
        &[],
    )?;
    if !existing.is_empty()
        && !db
            .query("PRAGMA table_info(datasets)", &[])?
            .iter()
            .any(|row| row[1] == "kind")
    {
        return Err(
            "Native legacy dataset migration is not yet verified; project has not been modified"
                .into(),
        );
    }
    if !db
        .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='raw_data'",
            &[],
        )?
        .is_empty()
        && (existing.is_empty()
            || db
                .query("SELECT COUNT(*) FROM datasets", &[])?
                .first()
                .is_some_and(|row| row[0] == 0))
    {
        return Err(
            "Native legacy raw_data conversion is not yet verified; project has not been modified"
                .into(),
        );
    }
    let tx = db.transaction()?;
    for sql in [
        "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT)",
        "CREATE TABLE IF NOT EXISTS model_spec (id INTEGER PRIMARY KEY,spec_json TEXT,diagram_layout_json TEXT,updated_at TEXT,model_key TEXT UNIQUE)",
        "CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY,algorithm TEXT,analysis_type TEXT,results_json TEXT,created_at TEXT,model_key TEXT,spec_json TEXT,diagram_layout_json TEXT,dataset_id TEXT,dataset_hash TEXT,spec_hash TEXT,params_json TEXT)",
        "CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,algorithm TEXT NOT NULL,results_json TEXT NOT NULL,model_spec_json TEXT NOT NULL,diagram_layout_json TEXT NOT NULL,created_at TEXT NOT NULL,source_model_id TEXT)",
        "CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT,kind TEXT NOT NULL DEFAULT 'imported',derivation_json TEXT,n_rows INTEGER NOT NULL,n_cols INTEGER NOT NULL,hash TEXT NOT NULL,settings_json TEXT,created_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS dataset_columns (dataset_id TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'indicator',scale_min REAL,scale_max REAL,reverse_coded INTEGER NOT NULL DEFAULT 0,label TEXT,PRIMARY KEY(dataset_id,name))",
        "CREATE TABLE IF NOT EXISTS dataset_values (dataset_id TEXT PRIMARY KEY,values_json TEXT NOT NULL)",
    ] {db.execute(sql,&[])?;}
    let cols = db.query("PRAGMA table_info(results)", &[])?;
    for column in [
        "analysis_type",
        "model_key",
        "spec_json",
        "diagram_layout_json",
        "dataset_id",
        "dataset_hash",
        "spec_hash",
        "params_json",
    ] {
        if !cols.iter().any(|row| row[1] == column) {
            db.execute(
                &format!("ALTER TABLE results ADD COLUMN {column} TEXT"),
                &[],
            )?;
        }
    }
    db.execute(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES ('schema_version','2.0')",
        &[],
    )?;
    tx.commit()?;
    Ok(())
}

/// Development-only stateful interoperability scenario. Always owns an isolated
/// temporary directory; the protocol cannot select an existing user project.
pub fn scenario(timestamp: String, actions: Vec<Value>) -> Result<Value, String> {
    struct Directory(PathBuf);
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let directory = Directory(
        std::env::temp_dir().join(format!("statsem-native-store-{}", uuid::Uuid::new_v4())),
    );
    fs::create_dir(&directory.0).map_err(|e| e.to_string())?;
    let store = Store::with_timestamp(directory.0.join("project.pls"), timestamp);
    let mut results = Vec::new();
    for action in actions {
        let key = action["model_id"].as_str();
        let result = match action["action"].as_str().unwrap_or("") {
            "create" => store.create(action["name"].as_str().unwrap_or("Study")),
            "metadata" => store.metadata(),
            "save_model" => store.save_model(&action["spec"], &action["diagram_layout"], key),
            "load_model" => store.load_model(key),
            "rename_model" => store.rename_model(
                key.unwrap_or("default"),
                action["name"].as_str().unwrap_or(""),
            ),
            "duplicate_model" => store.duplicate_model(
                action["source"].as_str().unwrap_or("default"),
                action["target"].as_str().unwrap_or("copy"),
            ),
            "save_results" => serde_json::from_value(action.clone())
                .map_err(|e| e.to_string())
                .and_then(|o| store.save_results(o)),
            "save_snapshot" => serde_json::from_value(action.clone())
                .map_err(|e| e.to_string())
                .and_then(|o| store.save_snapshot(o)),
            "list_snapshots" => store.list_snapshots(),
            "get_snapshot" => store.snapshot(action["id"].as_str().unwrap_or("")),
            "delete_snapshot" => store.delete_snapshot(action["id"].as_str().unwrap_or("")),
            "model_from_snapshot" => store.model_from_snapshot(
                action["id"].as_str().unwrap_or(""),
                key.unwrap_or("copy"),
                action["name"].as_str().unwrap_or("Copy"),
            ),
            "load_results" => store.load_results(
                action["algorithm"].as_str().unwrap_or("pls"),
                key,
                action["analysis_type"].as_str(),
            ),
            _ => Err("Unsupported project scenario action".into()),
        };
        results.push(result.unwrap_or_else(|error| json!({"error":error})));
    }
    Ok(json!(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_legacy_conversion_does_not_modify_the_original_file() {
        let directory =
            std::env::temp_dir().join(format!("statsem-legacy-check-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("legacy.pls");
        let db = Connection::open(&path, true).unwrap();
        db.execute("CREATE TABLE raw_data(x REAL)", &[]).unwrap();
        db.execute("INSERT INTO raw_data VALUES (3.5)", &[])
            .unwrap();
        drop(db);
        let before = fs::read(&path).unwrap();
        assert!(Store::new(&path)
            .metadata()
            .unwrap_err()
            .contains("not yet verified"));
        assert_eq!(before, fs::read(&path).unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn tilde_and_legacy_src_tauri_paths_resolve_to_home_directory() {
        let home = user_home_dir().expect("home dir should exist");
        let canonical_home = canonicalize_or_normalize(&home);

        assert_eq!(resolve_user_path("~").unwrap(), canonical_home);
        assert_eq!(
            resolve_user_path("~/StatSEM/Workspaces/final").unwrap(),
            canonical_home.join("StatSEM/Workspaces/final")
        );
        assert_eq!(
            resolve_user_path("~//StatSEM/Workspaces/final").unwrap(),
            canonical_home.join("StatSEM/Workspaces/final")
        );
        assert_eq!(
            resolve_user_path("/tmp/repo/src-tauri/~/StatSEM/Workspaces/final").unwrap(),
            canonical_home.join("StatSEM/Workspaces/final")
        );
    }

    #[test]
    fn store_rejects_unexpanded_tilde_components() {
        let bad = Store {
            path: PathBuf::from("/tmp/src-tauri/~/StatSEM/study.pls"),
            fixed_time: None,
        };
        assert!(bad.create("Study").unwrap_err().contains("Unexpanded '~'"));
    }

    #[test]
    fn non_destructive_migration_copies_pls_without_journals_or_source_deletion() {
        let directory =
            std::env::temp_dir().join(format!("statsem-migrate-test-{}", uuid::Uuid::new_v4()));
        let legacy_ws = directory.join("src-tauri/~/StatSEM/Workspaces/demo");
        let target_ws = directory.join("home/StatSEM/Workspaces/demo");
        fs::create_dir_all(legacy_ws.join("Archive")).unwrap();
        fs::write(legacy_ws.join("workspace.json"), br#"{"name":"demo"}"#).unwrap();
        let src_pls = legacy_ws.join("Demo.pls");
        {
            let db = Connection::open(&src_pls, true).unwrap();
            schema(&db).unwrap();
            db.execute(
                "INSERT OR REPLACE INTO metadata(key,value) VALUES ('name','Demo')",
                &[],
            )
            .unwrap();
        }
        fs::write(legacy_ws.join("Demo.pls-journal"), b"stale").unwrap();

        copy_dir_without_journals(&legacy_ws, &target_ws).unwrap();

        assert!(legacy_ws.join("Demo.pls").exists());
        assert!(legacy_ws.join("Demo.pls-journal").exists());
        assert!(target_ws.join("workspace.json").exists());
        assert!(target_ws.join("Archive").is_dir());
        assert!(target_ws.join("Demo.pls").is_file());
        assert!(!target_ws.join("Demo.pls-journal").exists());
        let meta = Store::new(target_ws.join("Demo.pls")).metadata().unwrap();
        assert_eq!(meta["name"], "Demo");
        fs::remove_dir_all(directory).unwrap();
    }
}
