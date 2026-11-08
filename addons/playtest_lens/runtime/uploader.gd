extends Node
## Sends playtest files to the developer's collector (a Google Apps Script web
## app, see docs/CLOUD_SYNC.md) in the background. Files that fail to send are
## retried later; a file is only re-sent when it changed.

signal failed(message: String)

const STATE_FILE := "user://playtest_lens/uploads.cfg"
const RETRY_SECONDS := 60.0

var url := ""
var key := ""
var game := ""

var _http: HTTPRequest
var _queue: Array[Dictionary] = []
var _job: Dictionary = {}
var _phase := ""
var _state := ConfigFile.new()
var _retry_left := 0.0
var _stopped := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_http = HTTPRequest.new()
	_http.timeout = 60.0
	_http.request_completed.connect(_on_completed)
	add_child(_http)
	_state.load(STATE_FILE)


func _process(delta: float) -> void:
	if _retry_left > 0.0:
		_retry_left -= delta
		if _retry_left <= 0.0:
			_next()


## Queues every session and map in these folders that changed since it was
## last sent. The live session is skipped; send it with send_text().
func send_folder(dir_path: String, kind: String, skip_path: String = "") -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	for file_name in DirAccess.get_files_at(dir_path):
		var path := dir_path.path_join(file_name)
		var ext := file_name.get_extension().to_lower()
		if path == skip_path or not ext in ["jsonl", "json", "png"]:
			continue
		send_file(path, kind)


func send_file(path: String, kind: String) -> void:
	var size := 0
	var file := FileAccess.open(path, FileAccess.READ)
	if file != null:
		size = file.get_length()
		file.close()
	if int(_state.get_value("sent", path.get_file(), -1)) == size:
		return
	_enqueue({"name": path.get_file(), "kind": kind, "path": path, "size": size})


## Sends text as a file (used for the session that is still being recorded).
func send_text(file_name: String, text: String) -> void:
	_enqueue({"name": file_name, "kind": "session", "text": text, "size": text.to_utf8_buffer().size()})


func _enqueue(job: Dictionary) -> void:
	if _stopped or url == "":
		return
	for i in _queue.size():
		if _queue[i]["name"] == job["name"]:
			_queue[i] = job
			return
	_queue.append(job)
	_next()


func _next() -> void:
	if _phase != "" or _queue.is_empty() or _retry_left > 0.0 or _stopped:
		return
	_job = _queue.pop_front()
	var encoding := "text"
	var content := ""
	if _job.has("text"):
		content = _job["text"]
	else:
		var bytes := FileAccess.get_file_as_bytes(_job["path"])
		if str(_job["name"]).get_extension().to_lower() == "png":
			encoding = "base64"
			content = Marshalls.raw_to_base64(bytes)
		else:
			content = bytes.get_string_from_utf8()
	var body := JSON.stringify({
		"key": key, "game": game, "kind": _job["kind"], "name": _job["name"],
		"encoding": encoding, "content": content,
	})
	# Apps Script answers a POST with a redirect to the reply, which must be
	# fetched with GET, so redirects are followed by hand.
	_http.max_redirects = 0
	_phase = "post"
	if _http.request(url, ["Content-Type: application/json"], HTTPClient.METHOD_POST, body) != OK:
		_retry("could not start the request")


func _on_completed(result: int, code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
	if _phase == "post" and code >= 300 and code < 400:
		var location := ""
		for header in headers:
			if header.to_lower().begins_with("location:"):
				location = header.substr(9).strip_edges()
		if location == "":
			_retry("redirect without a location")
			return
		_http.max_redirects = 8
		_phase = "reply"
		if _http.request(location) != OK:
			_retry("could not read the reply")
		return
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_retry("network error (result %d, HTTP %d)" % [result, code])
		return
	var reply: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not reply is Dictionary:
		_retry("unexpected reply from the collector")
		return
	if not reply.get("ok", false):
		# A wrong key or URL will not fix itself, so stop trying.
		_phase = ""
		_stopped = true
		var message := "Playtest Lens upload refused: %s" % str(reply.get("error", "unknown error"))
		push_warning(message)
		failed.emit(message)
		return
	_state.set_value("sent", _job["name"], _job["size"])
	_state.save(STATE_FILE)
	_phase = ""
	_next()


func _retry(reason: String) -> void:
	push_warning("Playtest Lens upload of %s failed (%s); retrying in %d s." % [_job.get("name", "?"), reason, int(RETRY_SECONDS)])
	_queue.push_front(_job)
	_phase = ""
	_retry_left = RETRY_SECONDS
