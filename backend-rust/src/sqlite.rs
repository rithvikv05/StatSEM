//! Small RAII wrapper for the system SQLite C API. No Python process/library.
//! Connections are local to their caller; statements cannot outlive connections.
use serde_json::{json, Value};
use std::{
    ffi::{CStr, CString},
    marker::PhantomData,
    os::raw::{c_char, c_int, c_void},
    path::Path,
    ptr,
};

#[repr(C)]
struct Database {
    _private: [u8; 0],
}
#[repr(C)]
struct Prepared {
    _private: [u8; 0],
}
#[link(name = "sqlite3")]
extern "C" {
    fn sqlite3_open_v2(
        name: *const c_char,
        db: *mut *mut Database,
        flags: c_int,
        vfs: *const c_char,
    ) -> c_int;
    fn sqlite3_close(db: *mut Database) -> c_int;
    fn sqlite3_errmsg(db: *mut Database) -> *const c_char;
    fn sqlite3_busy_timeout(db: *mut Database, ms: c_int) -> c_int;
    fn sqlite3_prepare_v2(
        db: *mut Database,
        sql: *const c_char,
        length: c_int,
        stmt: *mut *mut Prepared,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_finalize(stmt: *mut Prepared) -> c_int;
    fn sqlite3_step(stmt: *mut Prepared) -> c_int;
    fn sqlite3_bind_parameter_count(stmt: *mut Prepared) -> c_int;
    fn sqlite3_bind_null(stmt: *mut Prepared, index: c_int) -> c_int;
    fn sqlite3_bind_int64(stmt: *mut Prepared, index: c_int, value: i64) -> c_int;
    fn sqlite3_bind_double(stmt: *mut Prepared, index: c_int, value: f64) -> c_int;
    fn sqlite3_bind_text(
        stmt: *mut Prepared,
        index: c_int,
        value: *const c_char,
        length: c_int,
        destructor: Option<unsafe extern "C" fn(*mut c_void)>,
    ) -> c_int;
    fn sqlite3_column_count(stmt: *mut Prepared) -> c_int;
    fn sqlite3_column_type(stmt: *mut Prepared, column: c_int) -> c_int;
    fn sqlite3_column_int64(stmt: *mut Prepared, column: c_int) -> i64;
    fn sqlite3_column_double(stmt: *mut Prepared, column: c_int) -> f64;
    fn sqlite3_column_text(stmt: *mut Prepared, column: c_int) -> *const u8;
    fn sqlite3_column_blob(stmt: *mut Prepared, column: c_int) -> *const c_void;
    fn sqlite3_column_bytes(stmt: *mut Prepared, column: c_int) -> c_int;
    fn sqlite3_changes(db: *mut Database) -> c_int;
    fn sqlite3_last_insert_rowid(db: *mut Database) -> i64;
}
pub struct Connection {
    db: *mut Database,
}
struct Statement<'a> {
    stmt: *mut Prepared,
    db: &'a Connection,
    // SQLITE_STATIC binds require stable backing storage until finalization.
    text: Vec<Vec<u8>>,
    _borrow: PhantomData<&'a Connection>,
}
impl Connection {
    pub fn open(path: &Path, create: bool) -> Result<Self, String> {
        let name = CString::new(path.to_str().ok_or("SQLite path is not UTF-8")?)
            .map_err(|_| "SQLite path contains NUL")?;
        let mut db = ptr::null_mut();
        // SAFETY: name is NUL-terminated; db is a valid output pointer.
        let status = unsafe {
            sqlite3_open_v2(
                name.as_ptr(),
                &mut db,
                2 | if create { 4 } else { 0 },
                ptr::null(),
            )
        };
        if db.is_null() {
            return Err("SQLite could not allocate a connection".into());
        }
        let connection = Self { db };
        if status != 0 {
            return Err(connection.error());
        }
        // SAFETY: connection owns a live SQLite handle; integer duration only.
        let status = unsafe { sqlite3_busy_timeout(db, 5000) };
        if status != 0 {
            return Err(connection.error());
        }
        Ok(connection)
    }
    fn error(&self) -> String {
        // SAFETY: owned live handle; SQLite owns a terminated error string.
        unsafe {
            CStr::from_ptr(sqlite3_errmsg(self.db))
                .to_string_lossy()
                .into_owned()
        }
    }
    fn prepare(&self, sql: &str, params: &[Value]) -> Result<Statement<'_>, String> {
        let sql = CString::new(sql).map_err(|_| "SQLite SQL contains NUL")?;
        let mut statement = Statement {
            stmt: ptr::null_mut(),
            db: self,
            text: Vec::new(),
            _borrow: PhantomData,
        };
        // SAFETY: SQL/output pointers are valid during prepare. SQLite compiles
        // and owns the resulting statement, without retaining the SQL buffer.
        if unsafe {
            sqlite3_prepare_v2(
                self.db,
                sql.as_ptr(),
                -1,
                &mut statement.stmt,
                ptr::null_mut(),
            )
        } != 0
        {
            return Err(self.error());
        }
        if statement.stmt.is_null() {
            return Err("SQLite statement is empty".into());
        }
        // SAFETY: prepare produced a live statement handle.
        if unsafe { sqlite3_bind_parameter_count(statement.stmt) } as usize != params.len() {
            return Err("SQLite parameter count mismatch".into());
        }
        for (i, value) in params.iter().enumerate() {
            let index = (i + 1) as c_int;
            // SAFETY: every bind uses a live statement and valid index. Text
            // Text allocations are held by Statement through finalization.
            let status = unsafe {
                match value {
                    Value::Null => sqlite3_bind_null(statement.stmt, index),
                    Value::Bool(b) => sqlite3_bind_int64(statement.stmt, index, i64::from(*b)),
                    Value::Number(n) => {
                        if n.as_u64().is_some_and(|v| v > i64::MAX as u64) {
                            return Err("SQLite integer out of signed 64-bit range".into());
                        }
                        if let Some(v) = n.as_i64() {
                            sqlite3_bind_int64(statement.stmt, index, v)
                        } else {
                            sqlite3_bind_double(
                                statement.stmt,
                                index,
                                n.as_f64().ok_or("Unsupported SQLite number")?,
                            )
                        }
                    }
                    Value::String(s) => {
                        let mut text = s.as_bytes().to_vec();
                        let length = c_int::try_from(text.len())
                            .map_err(|_| "SQLite text parameter exceeds supported length")?;
                        text.push(0);
                        statement.text.push(text);
                        let text = statement.text.last().unwrap();
                        sqlite3_bind_text(
                            statement.stmt,
                            index,
                            text.as_ptr().cast::<c_char>(),
                            length,
                            None,
                        )
                    }
                    _ => return Err("Bind JSON containers as serialized text".into()),
                }
            };
            if status != 0 {
                return Err(self.error());
            }
        }
        Ok(statement)
    }
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Vec<Value>>, String> {
        let statement = self.prepare(sql, params)?;
        let mut rows = Vec::new();
        loop {
            // SAFETY: statement remains live for the complete query.
            let status = unsafe { sqlite3_step(statement.stmt) };
            if status == 101 {
                break;
            }
            if status != 100 {
                return Err(statement.db.error());
            }
            // SAFETY: a current result row exists; column indexes are bounded
            // by column_count. Copy all SQLite-owned bytes before next step.
            let row = unsafe {
                (0..sqlite3_column_count(statement.stmt))
                    .map(|j| match sqlite3_column_type(statement.stmt, j) {
                        1 => json!(sqlite3_column_int64(statement.stmt, j)),
                        2 => json!(sqlite3_column_double(statement.stmt, j)),
                        3 => {
                            let length = sqlite3_column_bytes(statement.stmt, j) as usize;
                            let data = sqlite3_column_text(statement.stmt, j);
                            if data.is_null() {
                                Value::Null
                            } else {
                                json!(String::from_utf8_lossy(std::slice::from_raw_parts(
                                    data, length
                                ))
                                .into_owned())
                            }
                        }
                        4 => {
                            let length = sqlite3_column_bytes(statement.stmt, j) as usize;
                            let data = sqlite3_column_blob(statement.stmt, j);
                            if data.is_null() {
                                json!([])
                            } else {
                                json!(std::slice::from_raw_parts(data.cast::<u8>(), length))
                            }
                        }
                        _ => Value::Null,
                    })
                    .collect()
            };
            rows.push(row);
        }
        Ok(rows)
    }
    pub fn execute(&self, sql: &str, params: &[Value]) -> Result<usize, String> {
        self.query(sql, params)?;
        // SAFETY: a live connection; changes refers to its latest statement.
        Ok(unsafe { sqlite3_changes(self.db) } as usize)
    }
    pub fn last_insert_id(&self) -> i64 {
        // SAFETY: a live connection; scalar connection-local accessor.
        unsafe { sqlite3_last_insert_rowid(self.db) }
    }
    pub fn transaction(&self) -> Result<Transaction<'_>, String> {
        self.execute("BEGIN IMMEDIATE", &[])?;
        Ok(Transaction {
            db: self,
            committed: false,
        })
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        // SAFETY: handle is owned once; Rust borrowing prevents live statements.
        unsafe {
            sqlite3_close(self.db);
        }
    }
}
impl Drop for Statement<'_> {
    fn drop(&mut self) {
        // SAFETY: finalization also accepts null after a failed prepare. Text
        // allocations remain alive until after this Drop method returns.
        unsafe {
            sqlite3_finalize(self.stmt);
        }
    }
}
pub struct Transaction<'a> {
    db: &'a Connection,
    committed: bool,
}
impl Transaction<'_> {
    pub fn commit(mut self) -> Result<(), String> {
        self.db.execute("COMMIT", &[])?;
        self.committed = true;
        Ok(())
    }
}
impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.db.execute("ROLLBACK", &[]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binds_unicode_and_quotes_and_rolls_back_uncommitted_work() {
        let db = Connection::open(Path::new(":memory:"), true).unwrap();
        db.execute(
            "CREATE TABLE items (id INTEGER PRIMARY KEY,name TEXT,value REAL)",
            &[],
        )
        .unwrap();
        db.execute(
            "INSERT INTO items(name,value) VALUES (?,?)",
            &[
                json!("研究er's 'dataset'; DROP TABLE items; --"),
                Value::Null,
            ],
        )
        .unwrap();
        assert_eq!(db.last_insert_id(), 1);
        {
            let _tx = db.transaction().unwrap();
            db.execute("UPDATE items SET name=?", &[json!("discard")])
                .unwrap();
        }
        assert_eq!(
            db.query("SELECT name,value FROM items", &[]).unwrap(),
            vec![vec![
                json!("研究er's 'dataset'; DROP TABLE items; --"),
                Value::Null
            ]]
        );
        let tx = db.transaction().unwrap();
        db.execute("UPDATE items SET value=?", &[json!(1.25)])
            .unwrap();
        tx.commit().unwrap();
        assert_eq!(
            db.query("SELECT value FROM items", &[]).unwrap(),
            vec![vec![json!(1.25)]]
        );
    }
    #[test]
    fn constraint_errors_leave_connection_usable_and_bad_binds_fail() {
        let db = Connection::open(Path::new(":memory:"), true).unwrap();
        db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)", &[])
            .unwrap();
        db.execute("INSERT INTO items VALUES (?)", &[json!(1)])
            .unwrap();
        assert!(db
            .execute("INSERT INTO items VALUES (?)", &[json!(1)])
            .is_err());
        assert!(db.query("SELECT ?", &[]).is_err());
        assert_eq!(
            db.query("SELECT ?", &[json!("embedded\0text")]).unwrap(),
            vec![vec![json!("embedded\0text")]]
        );
        assert!(db.query("SELECT ?", &[json!(u64::MAX)]).is_err());
        assert_eq!(
            db.query("SELECT COUNT(*) FROM items", &[]).unwrap(),
            vec![vec![json!(1)]]
        );
    }
}
