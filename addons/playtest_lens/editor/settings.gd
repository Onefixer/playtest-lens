@tool
extends RefCounted
## Project Settings for Playtest Lens (Project > Project Settings > Playtest Lens).
## The runtime reads the same keys with the same defaults, so settings left at
## their default are not written to project.godot.

const PREFIX := "playtest_lens/"

# [key, type, default, hint, hint_string]
const DEFINITIONS := [
	["general/enabled", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["general/record_in_editor", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["general/record_in_exported_builds", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["general/build_label", TYPE_STRING, "", PROPERTY_HINT_PLACEHOLDER_TEXT, "Defaults to application/config/version"],
	["tracking/sample_interval", TYPE_FLOAT, 0.5, PROPERTY_HINT_RANGE, "0.1,5,0.05,suffix:s"],
	["tracking/auto_level_from_scene", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["performance/record_performance", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["performance/interval", TYPE_FLOAT, 2.0, PROPERTY_HINT_RANGE, "0.5,30,0.5,suffix:s"],
	["maps/auto_capture", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["maps/max_size", TYPE_INT, 2048, PROPERTY_HINT_RANGE, "256,8192,1,suffix:px"],
	["maps/capture_delay", TYPE_FLOAT, 1.0, PROPERTY_HINT_RANGE, "0,10,0.1,suffix:s"],
	["tester/feedback_key", TYPE_STRING, "F8", PROPERTY_HINT_PLACEHOLDER_TEXT, "Empty to disable"],
	["tester/export_key", TYPE_STRING, "F9", PROPERTY_HINT_PLACEHOLDER_TEXT, "Empty to disable"],
	["tester/show_recording_indicator", TYPE_BOOL, false, PROPERTY_HINT_NONE, ""],
	["upload/enabled", TYPE_BOOL, false, PROPERTY_HINT_NONE, ""],
	["upload/url", TYPE_STRING, "", PROPERTY_HINT_PLACEHOLDER_TEXT, "Google Apps Script web app URL (docs/CLOUD_SYNC.md)"],
	["upload/key", TYPE_STRING, "", PROPERTY_HINT_PLACEHOLDER_TEXT, "UPLOAD_KEY from the collector script"],
	["upload/interval", TYPE_FLOAT, 60.0, PROPERTY_HINT_RANGE, "20,600,5,suffix:s"],
	["upload/ask_consent", TYPE_BOOL, true, PROPERTY_HINT_NONE, ""],
	["upload/upload_from_editor", TYPE_BOOL, false, PROPERTY_HINT_NONE, ""],
	["advanced/frame_clock", TYPE_BOOL, false, PROPERTY_HINT_NONE, ""],
]


static func register() -> void:
	for definition in DEFINITIONS:
		var key: String = PREFIX + definition[0]
		if not ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, definition[2])
		ProjectSettings.set_initial_value(key, definition[2])
		ProjectSettings.add_property_info({
			"name": key,
			"type": definition[1],
			"hint": definition[3],
			"hint_string": definition[4],
		})
		ProjectSettings.set_as_basic(key, true)


static func get_value(key: String) -> Variant:
	for definition in DEFINITIONS:
		if definition[0] == key:
			return ProjectSettings.get_setting(PREFIX + key, definition[2])
	return ProjectSettings.get_setting(PREFIX + key)


static func set_value(key: String, value: Variant) -> void:
	ProjectSettings.set_setting(PREFIX + key, value)
	ProjectSettings.save()
