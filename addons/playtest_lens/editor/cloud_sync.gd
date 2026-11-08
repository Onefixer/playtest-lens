@tool
extends Node
## Downloads the playtest files testers' games uploaded to the Google Drive
## collector (docs/CLOUD_SYNC.md) into user://playtest_lens/imported/cloud/,
## where the dashboard picks them up. Only new or changed files are fetched.

signal finished(new_files: int, message: String)

const DataStore := preload("data_store.gd")
const STATE_FILE := DataStore.DATA_DIR + "/cloud.cfg"
const CLOUD_DIR := DataStore.IMPORT_DIR + "/cloud"

var _http: HTTPRequest
var _url := ""
var _key := ""
var _todo: Array = []
var _current: Dictionary = {}
var _new := 0
var _state := ConfigFile.new()


func _ready() -> void:
	_http = HTTPRequest.new()
	_http.timeout = 60.0
	_http.request_completed.connect(_on_completed)
	add_child(_http)


func is_busy() -> bool:
	return _url != ""


func sync(url: String, read_key: String) -> void:
	if is_busy():
		return
	if url == "" or read_key == "":
		finished.emit(0, "Add the collector URL (Project Settings > Playtest Lens > Upload) and your read key first.")
		return
	_url = url
	_key = read_key
	_todo = []
	_new = 0
	_current = {}
	_state = ConfigFile.new()
	_state.load(STATE_FILE)
	_fetch("action=list&key=" + read_key.uri_encode())


func _fetch(query: String) -> void:
	var separator := "&" if _url.contains("?") else "?"
	if _http.request(_url + separator + query) != OK:
		_finish("Could not start the request.")


func _on_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_finish("Sync failed (result %d, HTTP %d). Check the URL, and that the script is deployed with access for Anyone." % [result, code])
		return
	var reply: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not reply is Dictionary:
		_finish("The collector sent an unexpected reply. Is the URL the web app URL ending in /exec?")
		return
	if not reply.get("ok", false):
		_finish("The collector refused: %s" % str(reply.get("error", "unknown error")))
		return
	if _current.is_empty():
		for entry in reply.get("files", []):
			var stamp := "%s:%s" % [str(entry.get("updated", "")), str(entry.get("size", ""))]
			if str(_state.get_value("files", str(entry.get("id", "")), "")) != stamp:
				entry["stamp"] = stamp
				_todo.append(entry)
	else:
		_save(_current, reply)
	_next()


func _next() -> void:
	if _todo.is_empty():
		_finish("Up to date." if _new == 0 else "Downloaded %d new or updated file%s." % [_new, "" if _new == 1 else "s"])
		return
	_current = _todo.pop_front()
	_fetch("action=get&key=%s&id=%s" % [_key.uri_encode(), str(_current.get("id", "")).uri_encode()])


func _save(entry: Dictionary, reply: Dictionary) -> void:
	var file_name := str(reply.get("name", entry.get("name", "file"))).get_file()
	var game := DataStore._safe_name(str(entry.get("game", "game")))
	var folder := CLOUD_DIR.path_join(game).path_join("maps" if entry.get("kind") == "map" else "sessions")
	DirAccess.make_dir_recursive_absolute(folder)
	var file := FileAccess.open(folder.path_join(file_name), FileAccess.WRITE)
	if file == null:
		return
	if reply.get("encoding") == "base64":
		file.store_buffer(Marshalls.base64_to_raw(str(reply.get("content", ""))))
	else:
		file.store_string(str(reply.get("content", "")))
	file.close()
	_state.set_value("files", str(entry.get("id", "")), entry["stamp"])
	_state.save(STATE_FILE)
	_new += 1


func _finish(message: String) -> void:
	_url = ""
	_current = {}
	finished.emit(_new, message)
