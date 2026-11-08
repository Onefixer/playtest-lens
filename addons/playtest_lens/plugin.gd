@tool
extends EditorPlugin
## Editor side of Playtest Lens: registers the PlaytestLens autoload and the
## project settings, and adds the "Playtest Lens" bottom panel.

const AUTOLOAD_NAME := "PlaytestLens"
const Settings := preload("editor/settings.gd")
const Dock := preload("editor/dock.gd")
const DebuggerBridge := preload("editor/debugger_bridge.gd")

var _dock: Dock
var _debugger: DebuggerBridge


func _enable_plugin() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, _addon_dir().path_join("runtime/playtest_lens.gd"))


func _disable_plugin() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)


func _enter_tree() -> void:
	Settings.register()
	_dock = Dock.new()
	_dock.addon_dir = _addon_dir()
	add_control_to_bottom_panel(_dock, "Playtest Lens")
	_debugger = DebuggerBridge.new()
	_debugger.event_received.connect(_dock.on_live_event)
	_debugger.game_started.connect(_dock.on_game_started)
	_debugger.game_stopped.connect(_dock.on_game_stopped)
	add_debugger_plugin(_debugger)
	scene_changed.connect(_dock.on_scene_changed)


func _exit_tree() -> void:
	if _debugger != null:
		remove_debugger_plugin(_debugger)
		_debugger = null
	if _dock != null:
		remove_control_from_bottom_panel(_dock)
		_dock.queue_free()
		_dock = null


func _addon_dir() -> String:
	return (get_script() as Script).resource_path.get_base_dir()
