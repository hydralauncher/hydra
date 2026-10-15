use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::path::Path;

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_ARGUMENTS: usize = 256;
const MAX_NONCE_LENGTH: usize = 128;
pub const MAX_COMMAND_UNITS: usize = 32_767;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub schema_version: u32,
    pub kind: Kind,
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub nonce: String,
    pub result_path: String,
}
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Exe,
    Msi,
    Reboot,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome<'a> {
    schema_version: u32,
    nonce: &'a str,
    exit_code: u32,
}
pub fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "invalid prerequisite request")
}
impl Config {
    pub fn read(file: &Path) -> io::Result<Self> {
        let metadata = std::fs::symlink_metadata(file)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_CONFIG_BYTES
        {
            return Err(invalid());
        }
        let mut bytes = Vec::new();
        std::fs::File::open(file)?
            .take(MAX_CONFIG_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_CONFIG_BYTES {
            return Err(invalid());
        }
        let config: Self = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        config.validate()?;
        let parent = file.parent().ok_or_else(invalid)?.canonicalize()?;
        let result_parent = Path::new(&config.result_path)
            .parent()
            .ok_or_else(invalid)?
            .canonicalize()?;
        if parent != result_parent || Path::new(&config.result_path).exists() {
            return Err(invalid());
        }
        Ok(config)
    }
    pub fn validate(&self) -> io::Result<()> {
        if self.schema_version != 1
            || self.args.len() > MAX_ARGUMENTS
            || self.nonce.is_empty()
            || self.nonce.len() > MAX_NONCE_LENGTH
            || !self
                .nonce
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || [&self.cwd, &self.result_path]
                .iter()
                .any(|s| s.is_empty() || s.contains('\0'))
            || self.executable.contains('\0')
            || (matches!(self.kind, Kind::Reboot)
                && (!self.executable.is_empty() || !self.args.is_empty()))
            || (!matches!(self.kind, Kind::Reboot) && self.executable.is_empty())
            || self.args.iter().any(|s| s.contains('\0'))
        {
            return Err(invalid());
        }
        let command = std::iter::once(self.executable.as_str())
            .chain(self.args.iter().map(String::as_str))
            .map(quote_argument)
            .collect::<Vec<_>>()
            .join(" ");
        if command.encode_utf16().count() >= MAX_COMMAND_UNITS {
            return Err(invalid());
        }
        Ok(())
    }
    pub fn write_outcome(&self, exit_code: u32) -> io::Result<()> {
        let destination = Path::new(&self.result_path);
        let temporary = destination.with_extension(format!("{}.tmp", self.nonce));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let bytes = serde_json::to_vec(&Outcome {
            schema_version: 1,
            nonce: &self.nonce,
            exit_code,
        })
        .map_err(|_| invalid())?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        if destination.exists() {
            return Err(invalid());
        }
        std::fs::rename(temporary, destination)
    }
}
/// Windows CRT argv rules; no command shell is involved.
pub fn quote_argument(value: &str) -> String {
    if !value.is_empty() && !value.chars().any(|c| c.is_whitespace() || c == '"') {
        return value.to_owned();
    }
    let mut quoted = String::from("\"");
    let mut slashes = 0;
    for character in value.chars() {
        if character == '\\' {
            slashes += 1;
            continue;
        }
        quoted.extend(std::iter::repeat_n(
            '\\',
            if character == '"' {
                slashes * 2 + 1
            } else {
                slashes
            },
        ));
        slashes = 0;
        quoted.push(character);
    }
    quoted.extend(std::iter::repeat_n('\\', slashes * 2));
    quoted.push('"');
    quoted
}

/// MSI parses its own command line and requires quotes around a property value.
pub fn quote_msi_argument(value: &str) -> String {
    if let Some((name, argument)) = value.split_once('=') {
        if !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return format!("{}={}", name, quote_argument(argument));
        }
    }
    quote_argument(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoting_preserves_empty_spaces_quotes_backslashes_and_shell_literals() {
        assert_eq!(quote_argument(""), "\"\"");
        assert_eq!(quote_argument("two words"), "\"two words\"");
        assert_eq!(quote_argument("a\"b"), "\"a\\\"b\"");
        assert_eq!(quote_argument("C:\\path\\"), "C:\\path\\");
        assert_eq!(quote_argument("C:\\two words\\"), "\"C:\\two words\\\\\"");
        assert_eq!(quote_argument("%PATH% & $(echo)"), "\"%PATH% & $(echo)\"");
    }
    #[test]
    fn msi_options_are_not_quoted_and_properties_quote_only_the_value() {
        assert_eq!(quote_msi_argument("/i"), "/i");
        assert_eq!(quote_msi_argument("/qn"), "/qn");
        assert_eq!(
            quote_msi_argument("INSTALLDIR=C:\\two words"),
            "INSTALLDIR=\"C:\\two words\""
        );
        assert_eq!(
            quote_msi_argument("REBOOT=ReallySuppress"),
            "REBOOT=ReallySuppress"
        );
        assert_eq!(quote_msi_argument("EMPTY="), "EMPTY=\"\"");
    }
    #[test]
    fn schema_rejects_shell_unknown_fields_and_unsafe_nonce() {
        let valid = r#"{"schemaVersion":1,"kind":"exe","executable":"a.exe","args":[],"cwd":"a","nonce":"attempt-1","resultPath":"result.json"}"#;
        let mut request: Config = serde_json::from_str(valid).unwrap();
        request.validate().unwrap();
        assert!(serde_json::from_str::<Config>(
            &valid.replace("\"kind\":\"exe\"", "\"kind\":\"shell\"")
        )
        .is_err());
        assert!(serde_json::from_str::<Config>(
            &valid.replace("\"args\":[]", "\"args\":[],\"shell\":true")
        )
        .is_err());
        request.nonce = "../other".into();
        assert!(request.validate().is_err());
        request.nonce = "a".repeat(MAX_NONCE_LENGTH);
        request.validate().unwrap();
        request.nonce.push('a');
        assert!(request.validate().is_err());
    }
    #[test]
    fn reboot_has_no_caller_selected_program_or_arguments() {
        let mut request: Config = serde_json::from_str(r#"{"schemaVersion":1,"kind":"reboot","executable":"","args":[],"cwd":"a","nonce":"attempt","resultPath":"a/result.json"}"#).unwrap();
        request.validate().unwrap();
        request.args.push("-k".into());
        assert!(request.validate().is_err());
        request.args.clear();
        request.executable = "other.exe".into();
        assert!(request.validate().is_err());
    }
    #[test]
    fn outcome_preserves_full_windows_dword() {
        for code in [0, 3010, 1641, 194, 105, u32::MAX] {
            let value = serde_json::to_value(Outcome {
                schema_version: 1,
                nonce: "attempt",
                exit_code: code,
            })
            .unwrap();
            assert_eq!(value["exitCode"].as_u64(), Some(u64::from(code)));
        }
    }
}
