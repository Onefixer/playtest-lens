@tool
extends RefCounted
## Reads, imports and bundles playtest data in user://playtest_lens/.
##
##   sessions/   sessions recorded on this machine
##   maps/       level pictures captured on this machine
##   imported/   data imported from testers (one folder per import)
##   report/     the generated dashboard

const DATA_DIR := "user://playtest_lens"
const SESSIONS_DIR := DATA_DIR + "/sessions"
const MAPS_DIR := DATA_DIR + "/maps"
const IMPORT_DIR := DATA_DIR + "/imported"
const REPORT_DIR := DATA_DIR + "/report"
const REPORT_FILE := REPORT_DIR + "/dashboard.html"


## Counts what is stored locally, for the bottom panel.
static func summary() -> Dictionary:
	var local := _walk(SESSIONS_DIR, ["jsonl"])
	var imported := _walk(IMPORT_DIR, ["jsonl"])
	var maps := _walk(MAPS_DIR, ["png"]) + _walk(IMPORT_DIR, ["png"])
	var bytes := 0
	var newest := 0
	for path in local + imported:
		var file := FileAccess.open(path, FileAccess.READ)
		if file != null:
			bytes += file.get_length()
		newest = maxi(newest, FileAccess.get_modified_time(path))
	return {
		"local": local.size(),
		"imported": imported.size(),
		"maps": maps.size(),
		"bytes": bytes,
		"newest": newest,
	}


## Imports a tester's export: a .zip from F9, a playtest_lens folder, or a
## single .jsonl file. Sessions that are already present are skipped.
static func import_path(path: String) -> Dictionary:
	var result := {"sessions": 0, "maps": 0, "skipped": 0, "error": ""}
	var known := {}
	for existing in _walk(SESSIONS_DIR, ["jsonl"]) + _walk(IMPORT_DIR, ["jsonl"]):
		known[existing.get_file()] = true
	var batch := _safe_name(path.get_file().get_basename() if not DirAccess.dir_exists_absolute(path) else path.trim_suffix("/").get_file())
	var dest := IMPORT_DIR.path_join(batch)
	var ext := path.get_extension().to_lower()
	if DirAccess.dir_exists_absolute(path):
		for file_path in _walk(path, ["jsonl", "png", "json"]):
			_store(file_path.get_file(), FileAccess.get_file_as_bytes(file_path), dest, known, result)
	elif ext == "zip":
		var zip := ZIPReader.new()
		var err := zip.open(path)
		if err != OK:
			result["error"] = "Could not open the zip file (error %d)." % err
			return result
		for entry in zip.get_files():
			var entry_ext := entry.get_extension().to_lower()
			if entry_ext in ["jsonl", "png", "json"]:
				_store(entry.get_file(), zip.read_file(entry), dest, known, result)
		zip.close()
	elif ext == "jsonl":
		_store(path.get_file(), FileAccess.get_file_as_bytes(path), dest, known, result)
	else:
		result["error"] = "Pick a .zip exported with F9, a playtest_lens folder, or a .jsonl session file."
	return result


## Deletes every recorded and imported session, map and report.
static func clear_all() -> void:
	for dir in [SESSIONS_DIR, MAPS_DIR, IMPORT_DIR, REPORT_DIR]:
		_remove_tree(dir)
	# Forget what was synced or uploaded, so a later sync starts fresh.
	for state_file in ["cloud.cfg", "uploads.cfg"]:
		DirAccess.remove_absolute(DATA_DIR.path_join(state_file))
	DirAccess.make_dir_recursive_absolute(SESSIONS_DIR)
	DirAccess.make_dir_recursive_absolute(MAPS_DIR)


## Writes a single self-contained dashboard HTML file with all local and
## imported data embedded, and returns its path ("" on failure). The file
## works offline and can be shared with teammates.
static func build_dashboard(addon_dir: String) -> String:
	var source_dir := addon_dir.path_join("dashboard")
	var html := FileAccess.get_file_as_string(source_dir.path_join("index.html"))
	if html == "":
		push_error("Playtest Lens: dashboard/index.html is missing from the addon.")
		return ""
	html = _inline_block(html, "<!--PL:STYLES-->", "<!--/PL:STYLES-->", source_dir, "href", "style")
	html = _inline_block(html, "<!--PL:SCRIPTS-->", "<!--/PL:SCRIPTS-->", source_dir, "src", "script")

	var files := []
	for path in _walk(SESSIONS_DIR, ["jsonl"]) + _walk(IMPORT_DIR, ["jsonl"]):
		files.append({"name": path.get_file(), "text": FileAccess.get_file_as_string(path)})
	var maps := []
	for path in _walk(MAPS_DIR, ["png"]) + _walk(IMPORT_DIR, ["png"]):
		var meta_path := path.get_basename() + ".json"
		if not FileAccess.file_exists(meta_path):
			continue
		var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string(meta_path))
		if not meta is Dictionary:
			continue
		maps.append({
			"name": path.get_file(),
			"meta": meta,
			"png": "data:image/png;base64," + Marshalls.raw_to_base64(FileAccess.get_file_as_bytes(path)),
		})
	var bundle := {
		"project": str(ProjectSettings.get_setting("application/config/name", "")),
		"generated": Time.get_datetime_string_from_system(true) + "Z",
		"files": files,
		"maps": maps,
	}
	# "</" inside the JSON would end the script tag early; "<\/" is the same string.
	var json := JSON.stringify(bundle, "", false).replace("</", "<\\/")
	html = html.replace("<!--PL:BUNDLE-->", "<script>window.PLAYTEST_LENS_BUNDLE = " + json + ";</script>")

	DirAccess.make_dir_recursive_absolute(REPORT_DIR)
	var out := FileAccess.open(REPORT_FILE, FileAccess.WRITE)
	if out == null:
		push_error("Playtest Lens: could not write %s (error %d)." % [REPORT_FILE, FileAccess.get_open_error()])
		return ""
	out.store_string(html)
	out.close()
	var sample := source_dir.path_join("sample-data.js")
	if FileAccess.file_exists(sample):
		var copy := FileAccess.open(REPORT_DIR.path_join("sample-data.js"), FileAccess.WRITE)
		if copy != null:
			copy.store_buffer(FileAccess.get_file_as_bytes(sample))
			copy.close()
	return REPORT_FILE


## Replaces the tags between two markers with the inlined files they point to.
static func _inline_block(html: String, start_marker: String, end_marker: String, source_dir: String, attribute: String, tag: String) -> String:
	var start := html.find(start_marker)
	var finish := html.find(end_marker)
	if start < 0 or finish < start:
		return html
	var block := html.substr(start, finish + end_marker.length() - start)
	var regex := RegEx.create_from_string(attribute + "=\"([^\"]+)\"")
	var inlined := ""
	for found in regex.search_all(block):
		var content := FileAccess.get_file_as_string(source_dir.path_join(found.get_string(1)))
		if tag == "script":
			content = content.replace("</script", "<\\/script")
		inlined += "<%s>\n%s\n</%s>\n" % [tag, content, tag]
	return html.replace(block, inlined)


static func _store(file_name: String, bytes: PackedByteArray, dest: String, known: Dictionary, result: Dictionary) -> void:
	var ext := file_name.get_extension().to_lower()
	var folder := "sessions" if ext == "jsonl" else "maps"
	if ext == "jsonl":
		if known.has(file_name):
			result["skipped"] += 1
			return
		known[file_name] = true
	DirAccess.make_dir_recursive_absolute(dest.path_join(folder))
	var file := FileAccess.open(dest.path_join(folder).path_join(file_name), FileAccess.WRITE)
	if file == null:
		return
	file.store_buffer(bytes)
	file.close()
	if ext == "jsonl":
		result["sessions"] += 1
	elif ext == "png":
		result["maps"] += 1


static func _walk(dir_path: String, extensions: Array) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	for file_name in dir.get_files():
		if extensions.has(file_name.get_extension().to_lower()):
			out.append(dir_path.path_join(file_name))
	for sub in dir.get_directories():
		out.append_array(_walk(dir_path.path_join(sub), extensions))
	return out


static func _remove_tree(dir_path: String) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	for file_name in dir.get_files():
		DirAccess.remove_absolute(dir_path.path_join(file_name))
	for sub in dir.get_directories():
		_remove_tree(dir_path.path_join(sub))
	DirAccess.remove_absolute(dir_path)


static func _safe_name(text: String) -> String:
	var cleaned := RegEx.create_from_string("[^A-Za-z0-9_\\-]+").sub(text.strip_edges(), "_", true)
	return cleaned if cleaned != "" else "import"
