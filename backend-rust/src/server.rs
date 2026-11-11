//! Local HTTP compatibility server for the existing desktop frontend.
//! It deliberately binds only to loopback and has no remote authentication role.
use crate::{
    bootstrap, pipeline, power,
    project_store::{
        canonicalize_or_normalize, resolve_user_path, user_home_dir, Dataset, Results, Snapshot,
        Store,
    },
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::Instant,
};

struct BootstrapJob {
    status: String,
    current: usize,
    total: usize,
    started: Instant,
    cancel: Arc<AtomicBool>,
    results: Value,
    error: Option<String>,
}
static BOOTSTRAP_JOBS: OnceLock<Mutex<HashMap<String, Arc<Mutex<BootstrapJob>>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Arc<Mutex<BootstrapJob>>>> {
    BOOTSTRAP_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn serve(host: &str, port: u16) -> Result<(), String> {
    if host != "127.0.0.1" && host != "localhost" {
        return Err("Native backend only permits loopback binding".into());
    }
    let listener = TcpListener::bind((host, port)).map_err(|e| e.to_string())?;
    let bound_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    println!("STATSEM_READY http://127.0.0.1:{bound_port}");
    std::io::stdout().flush().map_err(|e| e.to_string())?;
    for stream in listener.incoming().flatten() {
        // Dataset imports and analyses may take appreciably longer than a UI
        // request. Handle each loopback connection independently so a slow
        // calculation can never freeze workspace navigation.
        thread::spawn(move || {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(30)));
            let _ = handle(stream);
        });
    }
    Ok(())
}
fn handle(mut stream: TcpStream) -> Result<(), String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut length = 0usize;
    let mut origin = None;
    loop {
        line.clear();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().unwrap_or(0);
            } else if name.eq_ignore_ascii_case("origin") {
                origin = Some(value.trim().to_owned());
            }
        }
    }
    let mut raw = vec![0; length];
    reader.read_exact(&mut raw).map_err(|e| e.to_string())?;
    let body = if raw.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&raw)
            .unwrap_or_else(|_| json!({"_raw":String::from_utf8_lossy(&raw)}))
    };
    let (path, query) = split_target(&target);
    let result = route(&method, path, &query, body);
    let (status, value) = match result {
        Ok(value) => (200, value),
        Err(error) => (400, json!({"error":error})),
    };
    let response = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    write!(stream,"HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Headers: Content-Type, X-License-Token\r\nAccess-Control-Allow-Methods: GET, POST, PATCH, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n",status,if status==200{"OK"}else{"Bad Request"},response.len()).map_err(|e|e.to_string())?;
    if let Some(origin) = origin.filter(|value| {
        matches!(
            value.as_str(),
            "http://localhost:5185"
                | "http://127.0.0.1:5185"
                | "tauri://localhost"
                | "http://tauri.localhost"
                | "https://tauri.localhost"
        )
    }) {
        write!(
            stream,
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"
        )
        .map_err(|e| e.to_string())?;
    }
    write!(stream, "\r\n").map_err(|e| e.to_string())?;
    stream.write_all(&response).map_err(|e| e.to_string())?;
    Ok(())
}
fn split_target(target: &str) -> (&str, HashMap<String, String>) {
    let (path, raw) = target.split_once('?').unwrap_or((target, ""));
    let mut map = HashMap::new();
    for item in raw.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = item.split_once('=').unwrap_or((item, ""));
        map.insert(decode(k), decode(v));
    }
    (path, map)
}
fn decode(s: &str) -> String {
    let mut out = Vec::new();
    let mut bytes = s.as_bytes().iter().copied();
    while let Some(c) = bytes.next() {
        if c == b'+' {
            out.push(b' ')
        } else if c == b'%' {
            let a = bytes.next().unwrap_or(b'0');
            let b = bytes.next().unwrap_or(b'0');
            let hex = |v| match v {
                b'0'..=b'9' => v - b'0',
                b'a'..=b'f' => v - b'a' + 10,
                b'A'..=b'F' => v - b'A' + 10,
                _ => 0,
            };
            out.push(hex(a) * 16 + hex(b))
        } else {
            out.push(c)
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn value<'a>(body: &'a Value, _query: &HashMap<String, String>, key: &str) -> Option<&'a Value> {
    body.get(key)
}
fn text(body: &Value, query: &HashMap<String, String>, key: &str) -> Option<String> {
    value(body, query, key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| query.get(key).cloned())
}
fn number(body: &Value, key: &str, default: usize) -> usize {
    body[key].as_u64().map(|v| v as usize).unwrap_or(default)
}
fn resolved_text_path(
    body: &Value,
    query: &HashMap<String, String>,
    key: &str,
    missing_msg: &str,
) -> Result<PathBuf, String> {
    let raw = text(body, query, key).ok_or_else(|| missing_msg.to_string())?;
    resolve_user_path(&raw)
}
fn workspace_folder(body: &Value, query: &HashMap<String, String>) -> Result<PathBuf, String> {
    resolved_text_path(body, query, "folder_path", "folder_path required")
}
fn project(body: &Value, query: &HashMap<String, String>) -> Result<Store, String> {
    let raw = text(body, query, "project_path")
        .or_else(|| text(body, query, "path"))
        .ok_or("project path is required")?;
    Ok(Store::new(resolve_user_path(&raw)?))
}
type DatasetRows = (Vec<String>, Vec<Vec<Value>>, Value);
fn dataset(body: &Value, query: &HashMap<String, String>) -> Result<DatasetRows, String> {
    if let (Some(columns), Some(rows)) = (body["columns"].as_array(), body["rows"].as_array()) {
        return Ok((
            columns
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            rows.iter().filter_map(Value::as_array).cloned().collect(),
            body["dataset_id"].clone(),
        ));
    }
    let store = project(body, query)?;
    let data = store.dataset(text(body, query, "dataset_id").as_deref())?;
    if data.is_null() {
        return Err("No dataset found in project".into());
    };
    Ok((
        data["columns"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        data["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_array)
            .cloned()
            .collect(),
        data["id"].clone(),
    ))
}
fn spec(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    if body["spec"].is_object() {
        return Ok(body["spec"].clone());
    }
    let store = project(body, query)?;
    let loaded = store.load_model(text(body, query, "model_id").as_deref())?;
    if loaded.is_null() {
        Err("No model found in project".into())
    } else {
        Ok(loaded["spec"].clone())
    }
}
fn workspace_file(path: &Path) -> PathBuf {
    path.join("workspace.json")
}
fn workspace(path: &Path) -> Result<Value, String> {
    let file = workspace_file(path);
    let text = fs::read_to_string(file).map_err(|_| "Workspace not found".to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
fn save_workspace(path: &Path, data: &Value) -> Result<(), String> {
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::Normal(part) if part == "~"))
    {
        return Err(format!(
            "Unexpanded '~' directory component is not permitted in workspace path: {}",
            path.display()
        ));
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    fs::write(
        workspace_file(path),
        serde_json::to_vec_pretty(data).unwrap(),
    )
    .map_err(|e| e.to_string())
}
fn route(
    method: &str,
    path: &str,
    query: &HashMap<String, String>,
    body: Value,
) -> Result<Value, String> {
    if method == "OPTIONS" {
        return Ok(json!({}));
    }
    match (method, path) {
        ("GET", "/") | ("GET", "/health") => {
            let home_dir = user_home_dir().ok().map(|p| canonicalize_or_normalize(&p));
            Ok(json!({"status":"ok","backend":"rust","python_runtime":false,"home_dir":home_dir}))
        }
        ("POST", "/workspace/create") => {
            let folder =
                resolved_text_path(&body, query, "folder_path", "folder_path is required")?;
            let name = text(&body, query, "name")
                .filter(|s| !s.trim().is_empty())
                .ok_or("name is required")?;
            let data = json!({"name":name,"created_at":now(),"modified_at":now(),"projects":[],"archived_projects":[]});
            save_workspace(&folder, &data)?;
            fs::create_dir_all(folder.join("Archive")).map_err(|e| e.to_string())?;
            let folder = canonicalize_or_normalize(&folder);
            Ok(json!({"status":"success","path":folder,"workspace":data}))
        }
        ("POST", "/workspace/open") => {
            let folder =
                resolved_text_path(&body, query, "folder_path", "folder_path is required")?;
            let data = workspace(&folder)?;
            Ok(json!({"status":"success","path":folder,"workspace":data}))
        }
        ("POST", "/workspace/add-project") => {
            let folder =
                resolved_text_path(&body, query, "folder_path", "folder_path is required")?;
            let name = text(&body, query, "project_name")
                .filter(|s| !s.trim().is_empty())
                .ok_or("project_name is required")?;
            let mut ws = workspace(&folder)?;
            let filename = format!("{}.pls", safe_name(&name));
            let path = folder.join(&filename);
            Store::new(&path).create(&name)?;
            let canonical_project_path = canonicalize_or_normalize(&path);
            ws["projects"]
                .as_array_mut()
                .ok_or("Invalid workspace")?
                .push(json!({"path":filename,"name":name}));
            ws["modified_at"] = json!(now());
            save_workspace(&folder, &ws)?;
            Ok(json!({"status":"success","project_path":canonical_project_path,"project_name":name,"workspace":ws}))
        }
        ("POST", "/workspace/remove-project") => workspace_remove(query, &body, false),
        ("POST", "/workspace/delete-project") => workspace_remove(query, &body, true),
        ("POST", "/workspace/archive-project") => archive_project(query, &body),
        ("POST", "/workspace/restore-project") => restore_project(query, &body),
        ("POST", "/workspace/delete-archived-project") => delete_archived_project(query, &body),
        ("POST", "/workspace/archive") => archive_workspace(&workspace_folder(&body, query)?),
        ("POST", "/workspace/restore") => restore_workspace(&workspace_folder(&body, query)?),
        ("GET", "/workspace/archived-list") => archived_workspaces(),
        ("POST", "/project/open") => {
            let path = resolved_text_path(&body, query, "path", "path is required")?;
            if !path.is_file() {
                return Err("Project not found".into());
            }
            Ok(json!({"status":"success","path":canonicalize_or_normalize(&path)}))
        }
        ("GET", "/project/metadata") => project(&body, query)?.metadata(),
        ("GET", "/project/datasets") => Ok(json!({"datasets":project(&body,query)?.datasets()?})),
        ("GET", "/project/load-data") => {
            let data =
                project(&body, query)?.dataset(query.get("dataset_id").map(String::as_str))?;
            if data.is_null() {
                Err("Dataset not found".into())
            } else {
                Ok(data)
            }
        }
        ("POST", "/project/save-data-json") => {
            let store = project(&body, query)?;
            let parsed:Dataset=serde_json::from_value(json!({"id":body["dataset_id"],"name":body["dataset_name"].as_str().unwrap_or("Imported data"),"columns":body["columns"],"rows":body["rows"],"kind":"imported"})).map_err(|e|e.to_string())?;
            store.save_dataset(parsed)
        }
        ("POST", "/project/delete-data") => {
            let store = project(&body, query)?;
            store.delete_dataset(text(&body, query, "dataset_id").as_deref().unwrap_or("1"))?;
            Ok(json!({"status":"success"}))
        }
        ("POST", "/project/rename-data") => {
            let id = text(&body, query, "dataset_id").ok_or("dataset_id required")?;
            let name = text(&body, query, "name").ok_or("name required")?;
            project(&body, query)?.rename_dataset(&id, &name)
        }
        ("POST", "/project/save-model") => {
            let store = project(&body, query)?;
            let spec = body["spec"].clone();
            let layout = body.get("diagram_layout").cloned().unwrap_or(Value::Null);
            store.save_model(&spec, &layout, text(&body, query, "model_id").as_deref())?;
            Ok(json!({"status":"success","validation":validate(&spec,None)}))
        }
        ("GET", "/project/load-model") => {
            let out =
                project(&body, query)?.load_model(query.get("model_id").map(String::as_str))?;
            Ok(out)
        }
        ("POST", "/project/duplicate-model") => {
            let store = project(&body, query)?;
            store.duplicate_model(
                text(&body, query, "source_model_id")
                    .as_deref()
                    .ok_or("source_model_id required")?,
                text(&body, query, "new_model_id")
                    .as_deref()
                    .ok_or("new_model_id required")?,
            )
        }
        ("POST", "/project/rename-model") => project(&body, query)?.rename_model(
            text(&body, query, "model_id")
                .as_deref()
                .unwrap_or("default"),
            text(&body, query, "name")
                .as_deref()
                .ok_or("name required")?,
        ),
        ("POST", "/model/validate") => {
            Ok(validate(&body["spec"], body["dataset_columns"].as_array()))
        }
        ("POST", "/project/run-pls") => run_pls(&body, query),
        ("POST", "/project/bootstrap-start") => bootstrap_start(&body, query),
        ("POST", "/project/bootstrap-cancel") => {
            bootstrap_cancel(query.get("job_id").ok_or("job_id required")?)
        }
        ("GET", "/project/bootstrap-status") => {
            bootstrap_status(query.get("job_id").ok_or("job_id required")?)
        }
        ("GET", "/project/load-results") => Ok(project(&body, query)?.load_results(
            query.get("algorithm").map(String::as_str).unwrap_or("pls"),
            query.get("model_id").map(String::as_str),
            Some(query.get("analysis_type").map(String::as_str).unwrap_or("pls")),
        )?),
        ("GET", "/project/analysis-list") => Ok(json!({"analyses":project(&body,query)?.list_analysis_types(query.get("model_id").map(String::as_str))?})),
        ("POST", "/project/save-snapshot") => {
            let store = project(&body, query)?;
            let item:Snapshot=serde_json::from_value(json!({"name":body["name"],"description":body["description"],"algorithm":body["algorithm"],"results":body["results"],"spec":body["spec"],"diagram_layout":body["diagram_layout"],"source_model_id":body["source_model_id"]})).map_err(|e|e.to_string())?;
            store.save_snapshot(item)
        }
        ("GET", "/project/list-snapshots") => project(&body, query)?.list_snapshots(),
        ("GET", "/project/get-snapshot") => project(&body, query)?.snapshot(
            query
                .get("snapshot_id")
                .map(String::as_str)
                .ok_or("snapshot_id required")?,
        ),
        ("POST", "/project/delete-snapshot") => {
            project(&body, query)?.delete_snapshot(
                text(&body, query, "snapshot_id")
                    .as_deref()
                    .ok_or("snapshot_id required")?,
            )?;
            Ok(json!({"status":"success"}))
        }
        ("POST", "/project/create-model-from-snapshot") => project(&body, query)?
            .model_from_snapshot(
                text(&body, query, "snapshot_id")
                    .as_deref()
                    .ok_or("snapshot_id required")?,
                text(&body, query, "new_model_id")
                    .as_deref()
                    .ok_or("new_model_id required")?,
                text(&body, query, "new_model_name")
                    .as_deref()
                    .ok_or("new_model_name required")?,
            ),
        ("POST", "/data/derive") => derive(&body, query),
        ("POST", "/analysis/compare-prediction") => {
            let (columns, rows, _) = dataset(&body, query)?;
            let ids = body["snapshot_ids"].as_array().ok_or("Select two saved models")?;
            if ids.len() != 2 || ids[0] == ids[1] { return Err("Select two different saved models".into()); }
            let store = project(&body, query)?;
            let first = store.snapshot(ids[0].as_str().ok_or("Invalid snapshot")?)?;
            let second = store.snapshot(ids[1].as_str().ok_or("Invalid snapshot")?)?;
            if first.is_null() || second.is_null() { return Err("Saved model not found".into()); }
            let options: crate::predict::Options = serde_json::from_value(body["options"].clone()).map_err(|e| e.to_string())?;
            let results = crate::predict::compare(columns, rows, [first["spec"].clone(), second["spec"].clone()], json!({}), options)?;
            Ok(json!({"status":"success","results":results}))
        }
        ("POST", "/data/groups/generate") => {
            let (columns, rows, _) = dataset(&body, query)?;
            crate::data_groups::categorical(
                columns,
                rows,
                text(&body, query, "column").ok_or("column required")?,
                number(&body, "min_size", 10),
                number(&body, "max_paths_predictors", 2),
            )
        }
        ("POST", "/power/calculate") => power_route(&body),
        ("GET", "/power/table") => Ok(
            json!({"status":"success","results":power::table(query.get("alpha").and_then(|v|v.parse().ok()).unwrap_or(0.05),query.get("target_power").and_then(|v|v.parse().ok()).unwrap_or(0.8))?}),
        ),
        _ if path.starts_with("/analysis/") => analysis(path, &body, query),
        _ => Err(format!(
            "Native backend route not implemented: {method} {path}"
        )),
    }
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.trim().is_empty() {
        "Untitled study".into()
    } else {
        s
    }
}
fn workspace_remove(
    query: &HashMap<String, String>,
    body: &Value,
    delete: bool,
) -> Result<Value, String> {
    let folder = workspace_folder(body, query)?;
    let filename = text(body, query, "project_filename").ok_or("project_filename required")?;
    let mut ws = workspace(&folder)?;
    let projects = ws["projects"].as_array_mut().ok_or("Invalid workspace")?;
    projects.retain(|project| project["path"] != filename);
    if delete {
        let file = folder.join(&filename);
        if file.exists() {
            fs::remove_file(file).map_err(|e| e.to_string())?;
        }
    }
    ws["modified_at"] = json!(now());
    save_workspace(&folder, &ws)?;
    Ok(json!({"status":"success","workspace":ws}))
}
fn project_index(list: &[Value], filename: &str) -> Option<usize> {
    let wanted = Path::new(filename).file_name()?.to_str()?;
    list.iter().position(|item| {
        item["path"]
            .as_str()
            .and_then(|path| Path::new(path).file_name())
            .and_then(|name| name.to_str())
            == Some(wanted)
    })
}
fn archive_project(query: &HashMap<String, String>, body: &Value) -> Result<Value, String> {
    let folder = workspace_folder(body, query)?;
    let filename = text(body, query, "project_filename").ok_or("project_filename required")?;
    let mut ws = workspace(&folder)?;
    let projects = ws["projects"].as_array_mut().ok_or("Invalid workspace")?;
    let index = project_index(projects, &filename).ok_or("Project not found")?;
    let mut item = projects.remove(index);
    let base = Path::new(item["path"].as_str().ok_or("Project path missing")?)
        .file_name()
        .ok_or("Invalid project path")?
        .to_os_string();
    let source = folder.join(item["path"].as_str().unwrap());
    let destination = folder.join("Archive").join(&base);
    fs::create_dir_all(folder.join("Archive")).map_err(|e| e.to_string())?;
    if source.exists() {
        fs::rename(&source, &destination).map_err(|e| e.to_string())?
    };
    let relative = Path::new("Archive")
        .join(&base)
        .to_string_lossy()
        .into_owned();
    item["path"] = json!(relative);
    item["relative_path"] = item["path"].clone();
    item["archived_at"] = json!(now());
    ws["archived_projects"]
        .as_array_mut()
        .ok_or("Invalid workspace")?
        .push(item);
    ws["modified_at"] = json!(now());
    save_workspace(&folder, &ws)?;
    Ok(json!({"status":"archived","new_path":destination,"workspace":ws}))
}
fn restore_project(query: &HashMap<String, String>, body: &Value) -> Result<Value, String> {
    let folder = workspace_folder(body, query)?;
    let filename = text(body, query, "project_filename").ok_or("project_filename required")?;
    let mut ws = workspace(&folder)?;
    let archived = ws["archived_projects"]
        .as_array_mut()
        .ok_or("Invalid workspace")?;
    let index = project_index(archived, &filename).ok_or("Archived project not found")?;
    let mut item = archived.remove(index);
    let base = Path::new(item["path"].as_str().ok_or("Project path missing")?)
        .file_name()
        .ok_or("Invalid project path")?
        .to_os_string();
    let source = folder.join(item["path"].as_str().unwrap());
    let destination = folder.join(&base);
    if source.exists() {
        fs::rename(&source, &destination).map_err(|e| e.to_string())?
    };
    let relative = base.to_string_lossy().into_owned();
    item["path"] = json!(relative);
    item.as_object_mut()
        .ok_or("Invalid project")?
        .remove("relative_path");
    item.as_object_mut()
        .ok_or("Invalid project")?
        .remove("archived_at");
    ws["projects"]
        .as_array_mut()
        .ok_or("Invalid workspace")?
        .push(item);
    ws["modified_at"] = json!(now());
    save_workspace(&folder, &ws)?;
    Ok(json!({"status":"restored","new_path":destination,"workspace":ws}))
}
fn delete_archived_project(query: &HashMap<String, String>, body: &Value) -> Result<Value, String> {
    let folder = workspace_folder(body, query)?;
    let filename = text(body, query, "project_filename").ok_or("project_filename required")?;
    let mut ws = workspace(&folder)?;
    let archived = ws["archived_projects"]
        .as_array_mut()
        .ok_or("Invalid workspace")?;
    let index = project_index(archived, &filename).ok_or("Archived project not found")?;
    let item = archived.remove(index);
    let file = folder.join(item["path"].as_str().ok_or("Project path missing")?);
    if file.exists() {
        fs::remove_file(file).map_err(|e| e.to_string())?
    };
    ws["modified_at"] = json!(now());
    save_workspace(&folder, &ws)?;
    Ok(json!({"status":"deleted","workspace":ws}))
}
fn archive_root() -> Result<PathBuf, String> {
    let home = user_home_dir()?;
    let root = canonicalize_or_normalize(&home)
        .join("StatSEM")
        .join("Archive");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(canonicalize_or_normalize(&root))
}
fn unique_path(root: &Path, name: &str) -> PathBuf {
    let mut path = root.join(name);
    let mut n = 1;
    while path.exists() {
        path = root.join(format!("{name} ({n})"));
        n += 1;
    }
    path
}
fn archive_workspace(folder: &Path) -> Result<Value, String> {
    let mut ws = workspace(folder)?;
    let root = archive_root()?;
    let name = folder
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Invalid workspace path")?;
    let destination = unique_path(&root, name);
    ws["original_path"] = json!(folder);
    ws["archived_at"] = json!(now());
    save_workspace(folder, &ws)?;
    fs::rename(folder, &destination).map_err(|e| e.to_string())?;
    Ok(
        json!({"status":"archived","old_path":folder,"new_path":destination,"name":name,"archived_at":ws["archived_at"]}),
    )
}
fn restore_workspace(folder: &Path) -> Result<Value, String> {
    let mut ws = workspace(folder)?;
    let requested = match ws["original_path"].as_str() {
        Some(raw) => resolve_user_path(raw)?,
        None => canonicalize_or_normalize(&user_home_dir()?)
            .join("StatSEM")
            .join("Workspaces")
            .join(ws["name"].as_str().unwrap_or("Workspace")),
    };
    let parent = requested.parent().ok_or("Invalid restore path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let parent = canonicalize_or_normalize(parent);
    let destination = unique_path(
        &parent,
        requested
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or("Invalid restore path")?,
    );
    fs::rename(folder, &destination).map_err(|e| e.to_string())?;
    let destination = canonicalize_or_normalize(&destination);
    ws.as_object_mut()
        .ok_or("Invalid workspace")?
        .remove("original_path");
    ws.as_object_mut()
        .ok_or("Invalid workspace")?
        .remove("archived_at");
    ws["modified_at"] = json!(now());
    save_workspace(&destination, &ws)?;
    Ok(json!({"status":"restored","old_path":folder,"new_path":destination,"name":ws["name"]}))
}
fn archived_workspaces() -> Result<Value, String> {
    let root = archive_root()?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            if let Ok(ws) = workspace(&entry.path()) {
                entries.push(json!({"id":entry.path(),"path":entry.path(),"name":ws["name"],"original_path":ws["original_path"],"archived_at":ws["archived_at"],"project_count":ws["projects"].as_array().map_or(0,Vec::len)}));
            }
        }
    }
    Ok(json!({"status":"success","workspaces":entries}))
}
fn validate(spec: &Value, columns: Option<&Vec<Value>>) -> Value {
    let constructs = spec["constructs"].as_array().cloned().unwrap_or_default();
    let ids: Vec<_> = constructs.iter().filter_map(|c| c["id"].as_str()).collect();
    let mut errors = Vec::new();
    for c in &constructs {
        if c["indicators"].as_array().is_none_or(Vec::is_empty) {
            errors.push(format!(
                "Construct '{}' has no indicators",
                c["id"].as_str().unwrap_or("")
            ));
        }
    }
    for p in spec["paths"].as_array().into_iter().flatten() {
        let from = p
            .get("from")
            .or_else(|| p.get("from_node"))
            .and_then(Value::as_str);
        let to = p
            .get("to")
            .or_else(|| p.get("to_node"))
            .and_then(Value::as_str);
        if from.is_none()
            || to.is_none()
            || !ids.contains(&from.unwrap_or(""))
            || !ids.contains(&to.unwrap_or(""))
        {
            errors.push("Path references an unknown construct".into());
        }
    }
    if let Some(columns) = columns {
        for c in &constructs {
            for indicator in c["indicators"].as_array().into_iter().flatten() {
                let id = indicator.as_str().unwrap_or("");
                let mapped = spec["indicators"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|i| i["id"] == id)
                    .and_then(|i| i.get("column"))
                    .and_then(Value::as_str)
                    .unwrap_or(id);
                if !columns.iter().any(|x| x.as_str() == Some(mapped)) {
                    errors.push(format!("Indicator column '{mapped}' not found"));
                }
            }
        }
    }
    let mut incoming = HashMap::<&str, usize>::new();
    for p in spec["paths"].as_array().into_iter().flatten() {
        if let Some(to) = p
            .get("to")
            .or_else(|| p.get("to_node"))
            .and_then(Value::as_str)
        {
            *incoming.entry(to).or_default() += 1;
        }
    }
    json!({"is_valid":errors.is_empty(),"errors":errors,"warnings":[],"exogenous_constructs":ids.iter().filter(|id|!incoming.contains_key(**id)).collect::<Vec<_>>(),"endogenous_constructs":ids.iter().filter(|id|incoming.contains_key(**id)).collect::<Vec<_>>(),"isolated_constructs":[]})
}
fn run_pls(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, mut rows, dataset_id) = dataset(body, query)?;
    let spec = spec(body, query)?;
    let validation = validate(&spec, Some(&columns.iter().map(|s| json!(s)).collect()));
    if validation["is_valid"] != true {
        return Ok(json!({"status":"error","validation":validation,"error":"Model is invalid"}));
    };
    let mut settings = json!({"inner_weighting":body["scheme"].as_str().unwrap_or("path"),"max_iter":number(body,"max_iter",300),"tolerance":body["tol"].as_f64().unwrap_or(1e-7),"consistent":body["consistent"].as_bool().unwrap_or(false)});
    if let Some(input) = body.get("settings").and_then(Value::as_object) {
        for key in ["inner_weighting", "missing_treatment", "max_iter", "tolerance", "initial_weights", "individual_initial_weights", "weight_column"] {
            if let Some(value) = input.get(key) { settings[key] = value.clone(); }
        }
    }
    if !["mean", "listwise", "none"].contains(&settings["missing_treatment"].as_str().unwrap_or("mean")) {
        return Err("This missing-data treatment is not available for model estimation".into());
    }
    if settings["initial_weights"] == "individual" {
        let weights = settings["individual_initial_weights"].as_object().ok_or("Provide initial indicator weights")?;
        let parsed = crate::model::parse(&spec)?;
        for block in parsed.blocks {
            if block.indicators.iter().any(|id| !weights.get(id).is_some_and(|v| v.as_f64().is_some_and(f64::is_finite))) ||
                !block.indicators.iter().any(|id| weights[id].as_f64().unwrap_or(0.0) != 0.0) {
                return Err(format!("Provide finite initial weights with at least one nonzero weight for {}", block.id));
            }
        }
    }
    let data_filter = body.pointer("/settings/data_filter").filter(|v| !v.is_null()).cloned();
    if let Some(filter) = &data_filter {
        let column = filter["column"].as_str().ok_or("Group variable is required")?;
        let value = filter.get("value").filter(|v| v.is_string() || v.is_number() || v.is_boolean()).ok_or("Invalid group value")?;
        let index = columns.iter().position(|c| c == column).ok_or("Group variable is not in the dataset")?;
        rows.retain(|row| row.get(index).is_some_and(|v| crate::grouping::equal(v, value)));
        if rows.is_empty() { return Err("The selected group has no observations".into()); }
    }
    if let Some(column) = settings["weight_column"].as_str() {
        let index = columns.iter().position(|c| c == column).ok_or("Weight variable is not in the dataset")?;
        let mut sum = 0.0;
        for row in &rows {
            let weight = row.get(index).map(crate::model::numeric).unwrap_or(f64::NAN);
            if !weight.is_finite() || weight <= 0.0 { return Err("Observation weights must be finite, positive numbers".into()); }
            sum += weight;
        }
        if !sum.is_finite() || sum <= 0.0 { return Err("At least one observation weight must be positive".into()); }
    }
    let mut results = pipeline::run(columns, rows, spec.clone(), settings)?;
    if let Some(filter) = data_filter { results["settings"]["data_filter"] = filter; }
    let store = project(body, query)?;
    let layout = body.get("diagram_layout").cloned().unwrap_or(Value::Null);
    store.save_model(&spec, &layout, text(body, query, "model_id").as_deref())?;
    store.save_results(Results {
        results: results.clone(),
        spec,
        diagram_layout: layout,
        model_id: text(body, query, "model_id"),
        dataset_id: dataset_id.as_str().map(str::to_owned),
        ..Default::default()
    })?;
    Ok(json!({"status":"success","algorithm":"pls","results":results,"validation":validation}))
}
fn bootstrap_start(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, mut rows, dataset_id) = dataset(body, query)?;
    let model = spec(body, query)?;
    let validation = validate(&model, Some(&columns.iter().map(|s| json!(s)).collect()));
    if validation["is_valid"] != true {
        return Err("Model validation failed".into());
    }
    let total = number(body, "n_boot", 500);
    if total < 2 { return Err("At least two bootstrap samples are required".into()); }
    let mode = body["mode"].as_str().unwrap_or("complete");
    let ci = body["ci_method"].as_str().unwrap_or("percentile");
    let alpha = body["significance_level"].as_f64().unwrap_or(0.05);
    let tails = body["tails"].as_str().unwrap_or("two");
    let direction = body["direction"].as_str().unwrap_or("positive");
    if !["basic", "complete"].contains(&mode) || !["percentile", "bias_corrected", "bca", "studentized"].contains(&ci) || (ci == "studentized" && number(body, "studentized_resamples", 50) < 10) || !["one", "two"].contains(&tails) || !["positive", "negative"].contains(&direction) || !(0.0..0.5).contains(&alpha) || alpha == 0.0 {
        return Err("Invalid bootstrap settings".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    let job = Arc::new(Mutex::new(BootstrapJob {
        status: "running".into(),
        current: 0,
        total,
        started: Instant::now(),
        cancel: cancel.clone(),
        results: Value::Null,
        error: None,
    }));
    jobs()
        .lock()
        .map_err(|_| "Bootstrap jobs lock poisoned")?
        .insert(id.clone(), job.clone());
    let path = text(body, query, "project_path")
        .or_else(|| text(body, query, "path"))
        .map(|raw| resolve_user_path(&raw))
        .transpose()?;
    let model_id = text(body, query, "model_id");
    let layout = body.get("diagram_layout").cloned().unwrap_or(Value::Null);
    let mut model_settings = json!({"inner_weighting":body["scheme"].as_str().unwrap_or("path"),"max_iter":number(body,"max_iter",300),"tolerance":body["tol"].as_f64().unwrap_or(1e-7),"missing_treatment":"mean"});
    if let Some(input) = body.get("settings").and_then(Value::as_object) { for (key, value) in input { model_settings[key] = value.clone(); } }
    if let Some(filter) = model_settings.get("data_filter").filter(|v| !v.is_null()) {
        let column = filter["column"].as_str().ok_or("Group variable is required")?;
        let value = filter.get("value").filter(|v| v.is_string() || v.is_number() || v.is_boolean()).ok_or("Invalid group value")?;
        let index = columns.iter().position(|c| c == column).ok_or("Group variable is not in the dataset")?;
        rows.retain(|row| row.get(index).is_some_and(|v| crate::grouping::equal(v, value)));
        if rows.is_empty() { return Err("The selected group has no observations".into()); }
    }
    model_settings["consistent"] = json!(body["consistent"].as_bool().unwrap_or(false));
    let options = bootstrap::Options {
        n_boot: total,
        seed: body["seed"].as_u64().or(Some(42)),
        scheme: body["scheme"].as_str().unwrap_or("path").into(),
        consistent: body["consistent"].as_bool().unwrap_or(false),
        max_iter: number(body, "max_iter", 300),
        tol: body["tol"].as_f64().unwrap_or(1e-7),
        mode: mode.into(),
        ci_method: ci.into(),
        studentized_resamples: number(body, "studentized_resamples", 50),
        significance_level: alpha,
        tails: tails.into(),
        direction: direction.into(),
        n_workers: if body["parallel"].as_bool() == Some(false) { Some(1) } else { None },
        model_settings: model_settings.clone(),
        ..Default::default()
    };
    thread::spawn(move || {
        let progress_job = job.clone();
        let result = bootstrap::run_with_control(
            columns.clone(),
            rows.clone(),
            model.clone(),
            options,
            &cancel,
            &move |done, _| {
                if let Ok(mut j) = progress_job.lock() {
                    j.current = done;
                }
            },
        );
        match result {
            Ok(bootstrap_result) => {
                let mut results = match pipeline::run(columns, rows, model.clone(), model_settings) {
                    Ok(results) => results,
                    Err(error) => {
                        if let Ok(mut job) = job.lock() {
                            job.status = "failed".into();
                            job.error = Some(format!("Could not calculate the reference model: {error}"));
                        }
                        return;
                    }
                };
                if results.is_object() {
                    results["bootstrap"] = bootstrap_result.clone();
                    results["significance"] = bootstrap_result;
                }
                if let Some(path) = path {
                    let store = Store::new(path);
                    let _ = store.save_results(Results {
                        results: results.clone(),
                        spec: model,
                        diagram_layout: layout,
                        model_id,
                        dataset_id: dataset_id.as_str().map(str::to_owned),
                        ..Default::default()
                    });
                }
                if let Ok(mut j) = job.lock() {
                    j.status = "completed".into();
                    j.current = j.total;
                    j.results = results;
                }
            }
            Err(error) => {
                if let Ok(mut j) = job.lock() {
                    j.status = if cancel.load(Ordering::Relaxed) {
                        "cancelled".into()
                    } else {
                        "failed".into()
                    };
                    j.error = Some(error);
                }
            }
        }
    });
    Ok(json!({"status":"started","job_id":id,"n_boot":total}))
}
fn bootstrap_status(id: &str) -> Result<Value, String> {
    let job = jobs()
        .lock()
        .map_err(|_| "Bootstrap jobs lock poisoned")?
        .get(id)
        .cloned()
        .ok_or("Job not found")?;
    let j = job.lock().map_err(|_| "Bootstrap job lock poisoned")?;
    Ok(
        json!({"job_id":id,"status":j.status,"current":j.current,"total":j.total,"percent":if j.total==0{0.0}else{j.current as f64*100.0/j.total as f64},"elapsed_sec":j.started.elapsed().as_secs_f64(),"results":j.results,"error":j.error}),
    )
}
fn bootstrap_cancel(id: &str) -> Result<Value, String> {
    let job = jobs()
        .lock()
        .map_err(|_| "Bootstrap jobs lock poisoned")?
        .get(id)
        .cloned()
        .ok_or("Job not found")?;
    let mut j = job.lock().map_err(|_| "Bootstrap job lock poisoned")?;
    j.cancel.store(true, Ordering::Relaxed);
    j.status = "cancelled".into();
    Ok(json!({"status":"cancelled","job_id":id}))
}
fn derive(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, parent) = dataset(body, query)?;
    let result = crate::derived::apply(
        columns,
        rows,
        body["operation"].as_str().ok_or("operation required")?,
        body.get("params").cloned().unwrap_or(json!({})),
    )?;
    let store = project(body, query)?;
    let id = body["new_dataset_id"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("derived-{}", uuid::Uuid::new_v4()));
    let name = body["name"].as_str().unwrap_or("Derived dataset");
    store.save_dataset(Dataset{id:Some(id),name:name.into(),columns:result["columns"].as_array().unwrap().iter().filter_map(Value::as_str).map(str::to_owned).collect(),rows:result["rows"].as_array().unwrap().iter().filter_map(Value::as_array).cloned().collect(),parent_id:parent.as_str().map(str::to_owned),kind:"derived".into(),derivation:json!({"operation":body["operation"],"params":body["params"],"meta":result["meta"]}),settings:Value::Null})
}
fn power_route(body: &Value) -> Result<Value, String> {
    let target = body["target_power"].as_f64().unwrap_or(0.8);
    let options:power::Options=serde_json::from_value(json!({"n_samples":number(body,"n_samples",100),"n_predictors":number(body,"n_predictors",2),"r_squared":body["r_squared"],"effect_size_f2":body["effect_size_f2"],"alpha":body["alpha"].as_f64().unwrap_or(0.05),"target_power":target})).map_err(|e|e.to_string())?;
    let achieved = power::compute(&options)?;
    let minimum = power::minimum(&options)?;
    Ok(
        json!({"status":"success","achieved_power":achieved,"adequate_power":achieved>=target,"minimum_sample_size_required":minimum,"ten_times_rule":power::ten_times(number(body,"max_formative_indicators",1),number(body,"max_paths_into_construct",1)),"parameters":body}),
    )
}
fn analysis(path: &str, body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, mut rows, dataset_id) = dataset(body, query)?;
    if let Some(filter) = body.pointer("/settings/data_filter").filter(|v| !v.is_null()) {
        let column = filter["column"].as_str().ok_or("Group variable is required")?;
        let value = filter.get("value").filter(|v| v.is_string() || v.is_number() || v.is_boolean()).ok_or("Invalid group value")?;
        let index = columns.iter().position(|c| c == column).ok_or("Group variable is not in the dataset")?;
        rows.retain(|row| row.get(index).is_some_and(|v| crate::grouping::equal(v, value)));
        if rows.is_empty() { return Err("The selected group has no observations".into()); }
    }
    let spec = spec(body, query)?;
    if body.pointer("/settings/weight_column").is_some_and(|v| !v.is_null()) { return Err("Observation weights are not yet supported for this analysis".into()); }
    if body.pointer("/settings/initial_weights").and_then(Value::as_str) == Some("individual") {
        let weights = body.pointer("/settings/individual_initial_weights").and_then(Value::as_object).ok_or("Provide individual starting weights")?;
        for block in crate::model::parse(&spec)?.blocks {
            if block.indicators.iter().any(|id| !weights.get(id).and_then(Value::as_f64).is_some_and(f64::is_finite)) || !block.indicators.iter().any(|id| weights[id].as_f64().unwrap_or(0.0) != 0.0) { return Err(format!("Provide finite initial weights with at least one nonzero weight for {}", block.id)); }
        }
    }
    if path == "/analysis/pca" {
        let results = crate::pca::run(&columns, &rows, &spec)?;
        project(body, query)?.save_results(Results { results: results.clone(), spec, model_id: text(body, query, "model_id"), dataset_id: dataset_id.as_str().map(str::to_owned), analysis_type: "pca".into(), ..Default::default() })?;
        return Ok(json!({"status":"success","results":results}));
    }
    let op = match path {
        "/analysis/mediation" => "mediation",
        "/analysis/ipma" => "ipma",
        "/analysis/hcm" => "hcm",
        "/analysis/nca" => "nca",
        "/analysis/predict" => "predict",
        "/analysis/blindfolding" => "blindfolding",
        "/analysis/fimix" => "fimix",
        "/analysis/pos" => "pos",
        "/analysis/otg" => "otg",
        "/analysis/mga" => "mga",
        "/analysis/micom" => "micom",
        "/analysis/cta" => "cta",
        "/analysis/copula" => "run_pipeline",
        _ => return Err(format!("Native analysis route not implemented: {path}")),
    };
    let mut request = body.clone();
    request["op"] = json!(op);
    request["columns"] = json!(columns);
    request["rows"] = json!(rows);
    request["spec"] = spec.clone();
    // The browser API keeps options flat for ergonomics, while the native
    // engine keeps each analysis' configuration in an explicit options type.
    // Copy the fields into that nested object before serde deserializes it.
    if op != "run_pipeline" {
        request["options"] = body.clone();
        request["settings"] = body.get("settings").cloned().unwrap_or_else(|| json!({}));
    }
    if op == "run_pipeline" {
        request["settings"] = json!({"gc":{"ecdf":"F4"}});
        if !request["spec"]["gaussian_copulas"].is_array() {
            request["spec"]["gaussian_copulas"] =
                json!([{ "source":body["candidate_predictor"],"target":body["target_construct"] }]);
        }
    }
    let request: crate::Request = serde_json::from_value(request).map_err(|e| e.to_string())?;
    let mut results = crate::evaluate(request)?;
    if results.is_object() {
        let mut run_settings = serde_json::Map::new();
        for key in ["seed", "n_boot", "n_permutations", "alpha", "n_segments", "min_segments", "max_segments", "max_iter", "tol", "n_repetitions", "search_depth", "initial_separation", "criterion", "target_construct", "pre_segmentation", "fimix_options", "k_folds", "repetitions", "cvpat_resamples", "antecedents"] {
            if let Some(value) = body.get(key).filter(|v| !v.is_null()) { run_settings.insert(key.into(), value.clone()); }
        }
        if let Some(settings) = body.get("settings").filter(|v| v.is_object()) { run_settings.insert("model".into(), settings.clone()); }
        for key in ["parallel", "tails", "direction"] { if let Some(value) = body.get(key).filter(|v| !v.is_null()) { run_settings.insert(key.into(), value.clone()); } }
        results["run_settings"] = Value::Object(run_settings);
    }
    let store = project(body, query)?;
    store.save_results(Results {
        results: results.clone(),
        spec,
        model_id: text(body, query, "model_id"),
        dataset_id: dataset_id.as_str().map(str::to_owned),
        analysis_type: path.trim_start_matches("/analysis/").replace('-', "_"),
        ..Default::default()
    })?;
    Ok(json!({"status":"success","results":results}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pca_analysis_is_saved_as_a_distinct_result() {
        let base = std::env::temp_dir().join(format!("statsem-pca-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let path = base.join("model.pls");
        let store = Store::new(&path);
        store.create("Test").unwrap();
        let body = json!({"project_path":path,"model_id":"default","columns":["x","y"],"rows":[[1,2],[2,4],[3,6],[4,8]],"spec":{"constructs":[{"id":"A","name":"Alpha","indicators":["x","y"]}],"paths":[]}});
        let output = analysis("/analysis/pca", &body, &HashMap::new()).unwrap();
        assert_eq!(output["results"]["constructs"][0]["n_samples"], 4);
        assert!(store.list_analysis_types(Some("default")).unwrap().contains(&"pca".to_string()));
        let saved = store.load_results("pls", Some("default"), Some("pca")).unwrap();
        assert_eq!(saved["results"]["method"], "standardized_pca");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn result_lookup_keeps_base_and_analysis_results_separate() {
        let base = std::env::temp_dir().join(format!("statsem-results-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let path = base.join("model.pls");
        let store = Store::new(&path);
        store.create("Test").unwrap();
        store.save_results(Results { results: json!({"kind":"base"}), ..Default::default() }).unwrap();
        store.save_results(Results { analysis_type: "predict".into(), results: json!({"kind":"prediction"}), ..Default::default() }).unwrap();
        let mut query = HashMap::new();
        query.insert("path".into(), path.to_string_lossy().into_owned());
        let base_result = route("GET", "/project/load-results", &query, json!({})).unwrap();
        assert_eq!(base_result["results"]["kind"], "base");
        let list = route("GET", "/project/analysis-list", &query, json!({})).unwrap();
        assert_eq!(list["analyses"], json!(["predict"]));
        query.insert("analysis_type".into(), "predict".into());
        let prediction = route("GET", "/project/load-results", &query, json!({})).unwrap();
        assert_eq!(prediction["results"]["kind"], "prediction");
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn run_pls_uses_consistent_estimation_when_requested() {
        let base = std::env::temp_dir().join(format!("statsem-consistent-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let path = base.join("model.pls");
        Store::new(&path).create("Test").unwrap();
        let columns = vec!["a1", "a2", "a3", "b1", "b2", "b3"];
        let rows: Vec<Vec<f64>> = (0..48).map(|i| {
            let x = i as f64 * 0.13 - 3.0;
            let noise = (i as f64 * 1.7).sin();
            let y = 0.6 * x + 0.4 * noise;
            vec![x + 0.1 * noise, x - 0.2 * noise, 0.9 * x + 0.07 * noise,
                 y + 0.1 * noise, y - 0.08 * noise, 1.1 * y + 0.03 * noise]
        }).collect();
        let spec = json!({
            "constructs": [
                {"id":"A","name":"A","type":"reflective","indicators":["a1","a2","a3"]},
                {"id":"B","name":"B","type":"reflective","indicators":["b1","b2","b3"]}
            ],
            "indicators": columns.iter().map(|id| json!({"id":id,"column":id})).collect::<Vec<_>>(),
            "paths":[{"from":"A","to":"B"}]
        });
        let mut body = json!({"project_path":path,"columns":columns,"rows":rows,"spec":spec});
        let standard = run_pls(&body, &HashMap::new()).unwrap();
        assert_ne!(standard["results"]["is_consistent"], true);
        body["columns"].as_array_mut().unwrap().push(json!("group"));
        for (i, row) in body["rows"].as_array_mut().unwrap().iter_mut().enumerate() {
            row.as_array_mut().unwrap().push(json!(if i < 24 { 1 } else { 2 }));
        }
        body["settings"] = json!({"data_filter":{"column":"group","value":2}});
        let group = run_pls(&body, &HashMap::new()).unwrap();
        assert_eq!(group["results"]["n_samples"], 24);
        assert_eq!(group["results"]["settings"]["data_filter"]["value"], 2);
        body["settings"] = json!({"initial_weights":"individual", "individual_initial_weights":{"a1":1,"a2":2,"a3":1,"b1":1,"b2":1,"b3":1}});
        let weighted = run_pls(&body, &HashMap::new()).unwrap();
        assert_eq!(weighted["results"]["settings"]["individual_initial_weights"]["a2"], 2);
        body["k_folds"] = json!(4);
        body["repetitions"] = json!(1);
        body["cvpat_resamples"] = json!(10);
        let prediction = analysis("/analysis/predict", &body, &HashMap::new()).unwrap();
        assert_eq!(prediction["results"]["run_settings"]["model"]["individual_initial_weights"]["a2"], 2);
        body["settings"]["individual_initial_weights"]["a2"] = Value::Null;
        assert!(run_pls(&body, &HashMap::new()).is_err());
        assert!(analysis("/analysis/predict", &body, &HashMap::new()).is_err());
        body["settings"] = json!({"weight_column":"group"});
        let weighted = run_pls(&body, &HashMap::new()).unwrap();
        assert_eq!(weighted["results"]["settings"]["weight_column"], "group");
        body["rows"][0][6] = json!(0);
        assert!(run_pls(&body, &HashMap::new()).unwrap_err().contains("weights"));
        body["rows"][0][0] = Value::Null;
        body["settings"] = json!({"inner_weighting":"factor", "missing_treatment":"listwise", "max_iter":200, "tolerance":1e-6});
        let configured = run_pls(&body, &HashMap::new()).unwrap();
        assert_eq!(configured["results"]["settings"]["inner_weighting"], "factor");
        assert_eq!(configured["results"]["settings"]["missing_treatment"], "listwise");
        assert_eq!(configured["results"]["n_samples"], 47);
        body["settings"]["missing_treatment"] = json!("none");
        assert!(run_pls(&body, &HashMap::new()).unwrap_err().contains("Missing values"));
        body["settings"]["missing_treatment"] = json!("pairwise");
        assert!(run_pls(&body, &HashMap::new()).is_err());
        body["settings"] = json!({});
        body["consistent"] = json!(true);
        let consistent = run_pls(&body, &HashMap::new()).unwrap();
        assert_eq!(consistent["results"]["is_consistent"], true);
        assert!(consistent["results"]["structural"]["path_coefficients"]["B"]["A"].is_number());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn health_and_workspace_routes_return_canonical_paths() {
        let query = HashMap::new();
        let health = route("GET", "/health", &query, json!({})).unwrap();
        assert_eq!(health["status"], "ok");
        assert!(health["home_dir"].as_str().is_some_and(|s| !s.is_empty()));

        let base = std::env::temp_dir().join(format!("statsem-srv-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let ws_path = base.join("ws_one");
        let mut create_query = HashMap::new();
        create_query.insert("folder_path".into(), ws_path.to_string_lossy().into_owned());
        create_query.insert("name".into(), "ws_one".into());
        let created = route("POST", "/workspace/create", &create_query, json!({})).unwrap();
        let canon_ws = canonicalize_or_normalize(&ws_path);
        assert_eq!(
            created["path"].as_str().unwrap(),
            canon_ws.to_string_lossy().as_ref()
        );

        let mut add_query = HashMap::new();
        add_query.insert("folder_path".into(), ws_path.to_string_lossy().into_owned());
        add_query.insert("project_name".into(), "StudyOne".into());
        let added = route("POST", "/workspace/add-project", &add_query, json!({})).unwrap();
        assert_eq!(
            added["project_path"].as_str().unwrap(),
            canon_ws.join("StudyOne.pls").to_string_lossy().as_ref()
        );
        fs::remove_dir_all(base).unwrap();
    }
}
