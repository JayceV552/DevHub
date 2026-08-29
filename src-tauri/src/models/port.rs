use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PortOwnership {
    Managed,
    External,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub port: u16,
    pub protocol: &'static str,
    pub address: String,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub ownership: PortOwnership,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub run_id: Option<String>,
    pub command_id: Option<String>,
}
