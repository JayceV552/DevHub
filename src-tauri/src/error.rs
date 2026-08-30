use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no project with id `{0}`")]
    ProjectNotFound(String),

    #[error("project `{project}` has no command `{command}`")]
    CommandNotFound { project: String, command: String },

    #[error("no run with id `{0}`")]
    RunNotFound(String),

    #[error("`{command}` is already running for this project")]
    AlreadyRunning { command: String },

    #[error("`{0}` is not a directory")]
    NotADirectory(String),

    #[error(
        "`{program}` was not found.\n\nDevHub takes PATH from a login {shell} shell. \
         If {program} comes from a version manager (nvm, fnm, volta, asdf), check that \
         your shell profile sets it up — a GUI app does not inherit your terminal's PATH."
    )]
    ProgramNotFound { program: String, shell: String },

    #[error("failed to start `{program}`: {source}")]
    Spawn {
        program: String,
        #[source]
        source: std::io::Error,
    },

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("config file is not valid TOML: {0}")]
    ConfigParse(#[from] toml::de::Error),

    #[error("could not write config: {0}")]
    ConfigSerialize(#[from] toml::ser::Error),

    #[error("{0}")]
    Tauri(#[from] tauri::Error),

    #[error("could not read network sockets: {0}")]
    Netstat(String),

    #[error("could not reach the system keychain: {0}")]
    Keychain(String),

    #[error("no GitHub token configured — add one in Settings")]
    NoGitHubToken,

    #[error("GitHub authentication required.")]
    GitHubUnauthorized,

    #[error("GitHub request failed: {0}")]
    GitHub(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
