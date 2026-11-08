extends SceneTree
## Smoke test for the tester export, the editor's import, and the bundled
## dashboard. Run from the project folder:
##     godot --headless --path . --script res://tools/selftest.gd
## It writes a zip to the Desktop and deletes it again afterwards.

const DataStore := preload("res://addons/playtest_lens/editor/data_store.gd")

var _frames := 0
var _failures := 0


func _process(_delta: float) -> bool:
	_frames += 1
	if _frames < 3:
		return false
	var lens: Node = root.get_node_or_null("PlaytestLens")
	_check(lens != null, "PlaytestLens autoload is running")
	if lens != null:
		_check(lens.is_recording(), "a session is being recorded at " + lens.session_path)
		lens.death("selftest")
		lens.feedback("selftest note </script> with markup")
		var zip_path: String = lens.export_data()
		_check(zip_path != "" and FileAccess.file_exists(zip_path), "F9 export wrote " + zip_path)
		if zip_path != "":
			var result := DataStore.import_path(zip_path)
			_check(str(result["error"]) == "", "importing the export works")
			print("     ", result)
			DirAccess.remove_absolute(zip_path)
	var report := DataStore.build_dashboard("res://addons/playtest_lens")
	_check(report != "" and FileAccess.file_exists(report), "dashboard written to " + ProjectSettings.globalize_path(report))
	var html := FileAccess.get_file_as_string(report)
	_check(html.contains("window.PLAYTEST_LENS_BUNDLE = {"), "data is embedded in the dashboard")
	_check(not html.contains("<script src=\"app.js\""), "scripts are inlined")
	_check(not html.contains("note </script>"), "embedded text cannot end the script tag")
	print("     summary: ", DataStore.summary(), "  report: ", html.length() / 1024, " KB")
	print("RESULT: ", "all checks passed" if _failures == 0 else "%d check(s) failed" % _failures)
	quit(1 if _failures else 0)
	return true


func _check(ok: bool, what: String) -> void:
	if not ok:
		_failures += 1
	print(("PASS " if ok else "FAIL ") + what)
