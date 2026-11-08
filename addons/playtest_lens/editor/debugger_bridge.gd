@tool
extends EditorDebuggerPlugin
## Receives events from a game running from the editor (F5) so the bottom
## panel can show them live.

signal event_received(line: String)
signal game_started
signal game_stopped

const CAPTURE := "playtest_lens"
const MESSAGE := "playtest_lens:event"


func _has_capture(capture: String) -> bool:
	return capture == CAPTURE


func _capture(message: String, data: Array, _session_id: int) -> bool:
	if message != MESSAGE:
		return false
	if not data.is_empty():
		event_received.emit(str(data[0]))
	return true


func _setup_session(session_id: int) -> void:
	var session := get_session(session_id)
	session.started.connect(func() -> void: game_started.emit())
	session.stopped.connect(func() -> void: game_stopped.emit())
