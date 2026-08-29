use std::collections::{HashMap, HashSet};

use netstat2::{AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::error::{Error, Result};
use crate::models::{PortEntry, PortOwnership, Run};

pub struct PortManager {
    system: System,
}

impl Default for PortManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PortManager {
    pub fn new() -> Self {
        Self {
            system: System::new(),
        }
    }

    pub fn list(
        &mut self,
        running: &HashMap<u32, Run>,
        hide_system_ports: bool,
    ) -> Result<Vec<PortEntry>> {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::OnlyIfNotSet),
        );

        let sockets = netstat2::get_sockets_info(
            AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
            ProtocolFlags::TCP,
        )
        .map_err(|e| Error::Netstat(e.to_string()))?;

        let mut seen: HashSet<(u16, Option<u32>)> = HashSet::new();
        let mut entries = Vec::new();

        for socket in sockets {
            let ProtocolSocketInfo::Tcp(tcp) = &socket.protocol_socket_info else {
                continue;
            };
            if tcp.state != netstat2::TcpState::Listen {
                continue;
            }
            if hide_system_ports && tcp.local_port < 1024 {
                continue;
            }

            let pid = socket.associated_pids.first().copied();
            if !seen.insert((tcp.local_port, pid)) {
                continue;
            }

            let owner = pid.and_then(|pid| self.find_managed_ancestor(pid, running));

            entries.push(PortEntry {
                port: tcp.local_port,
                protocol: "tcp",
                address: tcp.local_addr.to_string(),
                pid,
                process_name: pid.and_then(|pid| self.process_name(pid)),
                ownership: if owner.is_some() {
                    PortOwnership::Managed
                } else {
                    PortOwnership::External
                },
                project_id: owner.as_ref().map(|r| r.project_id.clone()),
                project_name: owner.as_ref().map(|r| r.project_name.clone()),
                run_id: owner.as_ref().map(|r| r.run_id.clone()),
                command_id: owner.as_ref().map(|r| r.command_id.clone()),
            });
        }

        entries.sort_by_key(|e| e.port);
        Ok(entries)
    }

    fn find_managed_ancestor(&self, pid: u32, running: &HashMap<u32, Run>) -> Option<Run> {
        const MAX_DEPTH: usize = 24;

        let mut current = pid;
        for _ in 0..MAX_DEPTH {
            if let Some(run) = running.get(&current) {
                return Some(run.clone());
            }
            let parent = self.system.process(Pid::from_u32(current))?.parent()?;
            let parent = parent.as_u32();
            if parent <= 1 {
                return None;
            }
            current = parent;
        }
        None
    }

    fn process_name(&self, pid: u32) -> Option<String> {
        self.system
            .process(Pid::from_u32(pid))
            .map(|p| p.name().to_string_lossy().into_owned())
    }

    pub fn describe(&mut self, pid: u32) -> Option<(String, String)> {
        let target = Pid::from_u32(pid);
        self.system
            .refresh_processes(ProcessesToUpdate::Some(&[target]), true);
        let process = self.system.process(target)?;
        let name = process.name().to_string_lossy().into_owned();
        let cmd = process
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        Some((name, cmd))
    }

    pub fn kill(&mut self, pid: u32) -> Result<()> {
        let target = Pid::from_u32(pid);
        self.system
            .refresh_processes(ProcessesToUpdate::Some(&[target]), true);
        let process = self
            .system
            .process(target)
            .ok_or_else(|| Error::Other(format!("no process with pid {pid}")))?;

        let signalled = process.kill_with(sysinfo::Signal::Term).unwrap_or(false) || process.kill();

        if signalled {
            Ok(())
        } else {
            Err(Error::Other(format!("could not signal pid {pid}")))
        }
    }
}
