extends CanvasLayer
## On-screen UI for testers: the note box (F8), short toasts, and the
## optional recording indicator. Created on demand by the PlaytestLens autoload.

## Emitted when the note box closes. The text is empty when it was cancelled.
signal note_closed(text: String)
## Emitted when the tester answers the data-sharing question.
signal consent_answered(allowed: bool)

const PANEL_COLOR := Color(0.07, 0.08, 0.1, 0.94)
const BORDER_COLOR := Color(1, 1, 1, 0.12)
const MUTED_COLOR := Color(0.76, 0.76, 0.72)

var _note_panel: PanelContainer
var _note_edit: LineEdit
var _toast_panel: PanelContainer
var _toast_label: Label
var _toast_left := 0.0
var _indicator: Label


func _ready() -> void:
	layer = 128
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()


func _process(delta: float) -> void:
	if _toast_left <= 0.0:
		return
	_toast_left -= delta
	_toast_panel.modulate.a = clampf(_toast_left / 0.4, 0.0, 1.0)
	if _toast_left <= 0.0:
		_toast_panel.visible = false


func _input(input_event: InputEvent) -> void:
	if _note_panel == null or not _note_panel.visible:
		return
	if input_event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		_close_note("")


func open_note() -> void:
	_note_edit.text = ""
	_note_panel.visible = true
	_note_edit.grab_focus()


func show_toast(text: String, seconds: float = 4.0) -> void:
	_toast_label.text = text
	_toast_panel.visible = true
	_toast_panel.modulate.a = 1.0
	_toast_left = seconds


func set_indicator(show_indicator: bool) -> void:
	_indicator.visible = show_indicator


## Asks the tester once whether their playtest data may be sent to the developer.
func ask_consent(game_name: String) -> void:
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style(22))
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	var title := Label.new()
	title.text = "Share your playtest with the developer?"
	title.add_theme_font_size_override("font_size", 20)
	box.add_child(title)
	var text := Label.new()
	text.text = "This playtest build of %s can send what happens while you play (where you go, when you die, the notes you leave and the frame rate) to its developer, to help improve the game.\n\nNo names, accounts or other files from your computer are sent." % game_name
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.custom_minimum_size = Vector2(480, 0)
	text.add_theme_color_override("font_color", MUTED_COLOR)
	box.add_child(text)
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_END
	buttons.add_theme_constant_override("separation", 10)
	box.add_child(buttons)
	var no := Button.new()
	no.text = "Don't share"
	buttons.add_child(no)
	var yes := Button.new()
	yes.text = "Share"
	buttons.add_child(yes)
	no.pressed.connect(_answer_consent.bind(center, false))
	yes.pressed.connect(_answer_consent.bind(center, true))
	yes.grab_focus()


func _answer_consent(dialog: Control, allowed: bool) -> void:
	dialog.queue_free()
	consent_answered.emit(allowed)


func _close_note(text: String) -> void:
	_note_panel.visible = false
	_note_edit.release_focus()
	note_closed.emit(text)


func _build() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(center)

	_note_panel = PanelContainer.new()
	_note_panel.add_theme_stylebox_override("panel", _panel_style(20))
	_note_panel.visible = false
	center.add_child(_note_panel)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	_note_panel.add_child(box)

	var title := Label.new()
	title.text = "Playtest note"
	title.add_theme_font_size_override("font_size", 20)
	box.add_child(title)

	var hint := Label.new()
	hint.text = "What's on your mind right now? The note is saved with where you are in the game."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.custom_minimum_size = Vector2(460, 0)
	hint.add_theme_color_override("font_color", MUTED_COLOR)
	box.add_child(hint)

	_note_edit = LineEdit.new()
	_note_edit.placeholder_text = "e.g. I can't tell where to go next"
	_note_edit.max_length = 500
	_note_edit.custom_minimum_size = Vector2(460, 36)
	_note_edit.text_submitted.connect(_close_note)
	box.add_child(_note_edit)

	var keys := Label.new()
	keys.text = "Enter to save  ·  Esc to cancel"
	keys.add_theme_color_override("font_color", MUTED_COLOR)
	keys.add_theme_font_size_override("font_size", 13)
	box.add_child(keys)

	_toast_panel = PanelContainer.new()
	_toast_panel.add_theme_stylebox_override("panel", _panel_style(14))
	_toast_panel.anchor_left = 0.5
	_toast_panel.anchor_right = 0.5
	_toast_panel.anchor_top = 1.0
	_toast_panel.anchor_bottom = 1.0
	_toast_panel.offset_bottom = -32.0
	_toast_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_toast_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_panel.visible = false
	root.add_child(_toast_panel)

	_toast_label = Label.new()
	_toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_panel.add_child(_toast_label)

	_indicator = Label.new()
	_indicator.text = "● REC  F8 note · F9 export"
	_indicator.add_theme_color_override("font_color", Color(0.9, 0.3, 0.3))
	_indicator.add_theme_font_size_override("font_size", 13)
	_indicator.anchor_left = 1.0
	_indicator.anchor_right = 1.0
	_indicator.offset_top = 8.0
	_indicator.offset_right = -12.0
	_indicator.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_indicator.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_indicator.visible = false
	root.add_child(_indicator)


static func _panel_style(margin: float) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = PANEL_COLOR
	style.border_color = BORDER_COLOR
	style.set_border_width_all(1)
	style.set_corner_radius_all(10)
	style.set_content_margin_all(margin)
	return style
