mod commands;
mod error;
mod models;
mod services;
mod state;

/// Re-exports for integration tests.
#[doc(hidden)]
pub mod testing {
    pub use crate::models::ProjectScan;
    pub use crate::models::{
        ActivityColumn, ActivityState, ActivityType, ColumnFilters, CommandKind, CommandSpec,
        OutputStream, PortEntry, PortOwnership, Run, RunStatus,
    };
    pub use crate::services::process_manager::terminate_group;
    pub use crate::services::{Config, default_columns};
    pub use crate::services::{
        PathResolver, PortManager, ProcessManager, ProjectManager, RunRegistry,
    };
}

use tauri::{Manager, RunEvent};

use state::AppState;

#[cfg(unix)]
fn install_signal_handlers(app: tauri::AppHandle) {
    use tokio::signal::unix::{SignalKind, signal};

    tauri::async_runtime::spawn(async move {
        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut interrupt = match signal(SignalKind::interrupt()) {
            Ok(stream) => stream,
            Err(_) => return,
        };

        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
        }

        if let Some(state) = app.try_state::<AppState>() {
            state.processes.stop_all();
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        app.exit(0);
    });
}

#[cfg(windows)]
fn install_signal_handlers(_app: tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;

            let state = AppState::new(app.handle().clone(), &config_dir)?;
            app.manage(state);

            install_signal_handlers(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::list_projects,
            commands::projects::scan_project,
            commands::projects::add_project,
            commands::projects::update_project,
            commands::projects::remove_project,
            commands::projects::detect_new_commands,
            commands::processes::start_command,
            commands::processes::stop_run,
            commands::processes::restart_run,
            commands::processes::list_runs,
            commands::processes::get_run_output,
            commands::processes::clear_run,
            commands::processes::start_group,
            commands::processes::stop_group,
            commands::activity::activity_board,
            commands::activity::list_columns,
            commands::activity::add_column,
            commands::activity::update_column,
            commands::activity::remove_column,
            commands::activity::move_column,
            commands::activity::mark_column_read,
            commands::activity::list_saved,
            commands::activity::save_item,
            commands::activity::unsave_item,
            commands::clipboard::clipboard_snapshot,
            commands::clipboard::clipboard_image_data,
            commands::clipboard::copy_clipboard_entry,
            commands::clipboard::delete_clipboard_entry,
            commands::clipboard::clear_clipboard_history,
            commands::clipboard::app_memory,
            commands::clipboard::system_memory,
            commands::github::github_activity,
            commands::github::github_dashboard,
            commands::github::github_status,
            commands::github::github_start_login,
            commands::github::github_cancel_login,
            commands::github::set_github_token,
            commands::github::clear_github_token,
            commands::github::github_repositories,
            commands::github::github_search_repositories,
            commands::orphans::list_orphans,
            commands::orphans::stop_orphan,
            commands::orphans::dismiss_orphan,
            commands::orphans::stop_all_orphans,
            commands::ports::list_ports,
            commands::ports::describe_process,
            commands::ports::kill_port_process,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::get_config_path,
            commands::settings::get_resolved_path,
            commands::todo::todo_board,
            commands::todo::todo_repository_issues,
            commands::todo::set_todo_repositories,
            commands::todo::add_todo,
            commands::todo::update_todo,
            commands::todo::set_todo_step,
            commands::todo::set_todo_completed,
            commands::todo::delete_todo,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DevHub")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit)
                && let Some(state) = app.try_state::<AppState>()
            {
                state.processes.stop_all();
            }
        });
}
