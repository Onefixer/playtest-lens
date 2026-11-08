extends Node2D
## Reef Runner: a tiny roguelite used to demo Playtest Lens.
##
## A run is three stages (Shallows, Kelp Maze, Abyss) with an upgrade pick
## between stages. Every Playtest Lens call the game makes is marked with
## "Playtest Lens:" so you can see how little integration it needs.
##
## Command line options (after "--"):
##   --demo-bot              a simulated tester plays instead of you
##   --demo-seed=N           which simulated tester (skill, patience, ...)
##   --demo-build=0.3|0.4    0.3 has the unfair gate and the laggy jellies
##   --demo-crash            simulate a crash in the jellyfish room (0.3)
##   --demo-capture-maps     capture every level map, then quit

const Levels := preload("levels.gd")
const LevelNode := preload("level.gd")
const Diver := preload("diver.gd")
const Bot := preload("bot.gd")

const UPGRADES := {
	"lantern": {"title": "Lantern", "text": "See much further in the dark Abyss."},
	"swift_fins": {"title": "Swift Fins", "text": "Swim 20% faster."},
	"thick_shell": {"title": "Thick Shell", "text": "One extra life this run."},
	"lucky_pearl": {"title": "Lucky Pearl", "text": "Pearls drift toward you."},
}
const DARKNESS_SHADER := """
shader_type canvas_item;
uniform vec2 light_pos = vec2(640.0, 360.0);
uniform vec2 rect_size = vec2(1280.0, 720.0);
uniform float radius = 120.0;
void fragment() {
	float d = distance(UV * rect_size, light_pos);
	COLOR = vec4(0.0, 0.01, 0.03, smoothstep(radius * 0.45, radius, d) * 0.94);
}
"""

var build := "0.4"
var bot_mode := false
var heavy_effects := false
var state := "play"
var sim_time := 0.0

var _layouts: Array[Dictionary] = []
var _level: LevelNode
var _level_index := 0
var _diver: Diver
var _bot: Bot
var _lives := 2
var _upgrades: Array[String] = []
var _pearls := 0
var _runs := 0
var _offer: Array[String] = []
var _crash_planned := false
var _seed := 1

var _status: Label
var _panel: PanelContainer
var _panel_title: Label
var _panel_text: Label
var _panel_buttons: HBoxContainer
var _darkness: ColorRect


func _ready() -> void:
	_setup_input()
	_parse_args()
	_layouts = Levels.all()
	var camera := Camera2D.new()
	camera.position = Vector2(Levels.WIDTH, Levels.HEIGHT) * LevelNode.CELL / 2.0
	add_child(camera)
	_diver = Diver.new()
	_diver.name = "Diver"
	# Playtest Lens: nodes in this group get their position recorded. That is
	# all it takes for movement heatmaps, stuck detection and quit locations.
	_diver.add_to_group("playtest_track")
	_diver.dashed.connect(func() -> void: PlaytestLens.event("dash"))
	add_child(_diver)
	_build_hud()
	if "--demo-capture-maps" in OS.get_cmdline_user_args():
		_capture_all_maps()
		return
	if bot_mode:
		_bot = Bot.new()
		_bot.setup(self, _seed)
		add_child(_bot)
	start_run()


func _physics_process(delta: float) -> void:
	sim_time += delta
	if state != "play" or _level == null:
		return
	var pos := _diver.global_position
	if _diver.invulnerable <= 0.0:
		var cause: String = _level.hazard_at(pos, Diver.RADIUS)
		if cause != "":
			_die(cause)
			return
	var reach := 46.0 if has_upgrade("lucky_pearl") else 16.0
	if _level.take_pearl(pos, reach):
		_pearls += 1
		# Playtest Lens: pickups show up per level and as a heatmap layer.
		PlaytestLens.item("pearl")
	if _level.is_exit(pos):
		_complete_level()
	_update_status()


func _process(_delta: float) -> void:
	if _level == null:
		return
	if _darkness.visible:
		var mat := _darkness.material as ShaderMaterial
		mat.set_shader_parameter("light_pos", _diver.get_global_transform_with_canvas().origin)
		mat.set_shader_parameter("rect_size", _darkness.size)
		mat.set_shader_parameter("radius", 230.0 if has_upgrade("lantern") else 115.0)
	if heavy_effects and state == "play" and _level.jelly_area.has_point(_diver.global_position):
		if _crash_planned and sim_time > 20.0:
			_simulate_crash()
		# The jelly room's "particles" are expensive in build 0.3, which is
		# what the dashboard's frame-rate insight picks up.
		var until := Time.get_ticks_usec() + (45000 if build == "0.3" else 5000)
		while Time.get_ticks_usec() < until:
			pass


func _unhandled_input(event: InputEvent) -> void:
	if bot_mode or not event is InputEventKey or not event.pressed:
		return
	var key := (event as InputEventKey).keycode
	if state == "choose" and key >= KEY_1 and key <= KEY_3 and key - KEY_1 < _offer.size():
		_pick(_offer[key - KEY_1])
	elif (state == "over" or state == "won") and (key == KEY_ENTER or key == KEY_SPACE):
		start_run()


func has_upgrade(upgrade_id: String) -> bool:
	return _upgrades.has(upgrade_id)


func start_run() -> void:
	_runs += 1
	_lives = 2
	_upgrades.clear()
	_pearls = 0
	_diver.speed_multiplier = 1.0
	_panel.visible = false
	# Playtest Lens: runs power "where do runs end" and upgrade impact.
	PlaytestLens.run_start()
	_load_level(0)


func quit_session() -> void:
	state = "quit"
	get_tree().quit()


func _load_level(index: int) -> void:
	if _level != null:
		_level.queue_free()
	_level_index = index
	_level = LevelNode.new()
	_level.setup(_layouts[index], build)
	add_child(_level)
	move_child(_level, 0)
	# Playtest Lens: this game keeps every stage in one scene, so it names the
	# level itself. Games with one scene per level get this automatically.
	PlaytestLens.set_level(_level.level_id)
	PlaytestLens.progress(index + 1, _level.title)
	_darkness.visible = _level.dark
	state = "play"
	_respawn()
	if _bot != null:
		_bot.on_level_loaded(_level, _diver)


func _respawn() -> void:
	_diver.global_position = _level.start_position
	_diver.stop()
	_diver.invulnerable = 1.0
	if _bot != null:
		_bot.on_respawn()
	_update_status()


func _die(cause: String) -> void:
	# Playtest Lens: the position comes from the tracked diver.
	PlaytestLens.death(cause)
	_lives -= 1
	if _bot != null:
		_bot.on_death(cause)
	if _lives > 0:
		_respawn()
		return
	PlaytestLens.level_failed()
	PlaytestLens.run_end("death")
	state = "over"
	_show_panel("Run over", "You were lost in the %s with %d pearls.\nPress Enter to dive again." % [_level.title, _pearls], [])
	_after_run()


func _complete_level() -> void:
	PlaytestLens.level_complete({"pearls": _pearls})
	if _level_index < _layouts.size() - 1:
		_offer_upgrades()
		return
	PlaytestLens.run_end("win", {"pearls": _pearls})
	state = "won"
	_show_panel("You escaped the Abyss!", "%d pearls collected. Press Enter for another run." % _pearls, [])
	if _bot != null:
		_bot.on_run_won()
	_after_run()


func _after_run() -> void:
	if _bot == null:
		return
	await get_tree().create_timer(1.5).timeout
	if state == "quit":
		return
	if _bot.wants_another_run():
		start_run()
	else:
		quit_session()


func _offer_upgrades() -> void:
	state = "choose"
	_diver.stop()
	var pool: Array[String] = []
	for upgrade_id in UPGRADES:
		if not _upgrades.has(upgrade_id):
			pool.append(upgrade_id)
	pool.shuffle()
	_offer.clear()
	for i in mini(3, pool.size()):
		_offer.append(pool[i])
	var labels: Array[String] = []
	for i in _offer.size():
		labels.append("%d  %s" % [i + 1, UPGRADES[_offer[i]]["title"]])
	_show_panel("Choose an upgrade", "Stage %d cleared. Pick one (1-3):" % (_level_index + 1), labels)
	if _bot != null:
		await get_tree().create_timer(0.8).timeout
		if state == "choose":
			_pick(_bot.pick_upgrade(_offer))


func _pick(upgrade_id: String) -> void:
	# Playtest Lens: offered options plus the pick give pick rates and show
	# which upgrades actually help players get further.
	PlaytestLens.choice("upgrade", _offer, upgrade_id)
	_upgrades.append(upgrade_id)
	if upgrade_id == "swift_fins":
		_diver.speed_multiplier = 1.2
	elif upgrade_id == "thick_shell":
		_lives += 1
	_panel.visible = false
	_load_level(_level_index + 1)


func _simulate_crash() -> void:
	# Ends the process without a clean shutdown, like a real crash would.
	OS.kill(OS.get_process_id())


func _capture_all_maps() -> void:
	for index in _layouts.size():
		_load_level(index)
		_diver.visible = false
		await get_tree().create_timer(0.4).timeout
		await PlaytestLens.capture_map(_level.level_id, _level.get_playtest_bounds(), true)
	get_tree().quit()


func _parse_args() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg == "--demo-bot":
			bot_mode = true
			heavy_effects = true
		elif arg.begins_with("--demo-seed="):
			_seed = int(arg.get_slice("=", 1))
		elif arg.begins_with("--demo-build="):
			build = arg.get_slice("=", 1)
		elif arg == "--demo-crash":
			_crash_planned = true
	if not bot_mode:
		build = str(ProjectSettings.get_setting("application/config/version", "0.4"))


func _setup_input() -> void:
	var bindings := {
		"move_left": [KEY_A, KEY_LEFT],
		"move_right": [KEY_D, KEY_RIGHT],
		"move_up": [KEY_W, KEY_UP],
		"move_down": [KEY_S, KEY_DOWN],
		"dash": [KEY_SPACE, KEY_SHIFT],
	}
	for action in bindings:
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.2)
		for keycode in bindings[action]:
			var key := InputEventKey.new()
			key.physical_keycode = keycode
			InputMap.action_add_event(action, key)


# --- HUD ------------------------------------------------------------------------

func _build_hud() -> void:
	var hud := CanvasLayer.new()
	hud.layer = 10
	add_child(hud)

	_darkness = ColorRect.new()
	_darkness.set_anchors_preset(Control.PRESET_FULL_RECT)
	_darkness.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = DARKNESS_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = shader
	_darkness.material = mat
	_darkness.visible = false
	hud.add_child(_darkness)

	_status = Label.new()
	_status.position = Vector2(16, 8)
	_status.add_theme_font_size_override("font_size", 16)
	_status.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	_status.add_theme_constant_override("outline_size", 4)
	hud.add_child(_status)

	var help := Label.new()
	help.text = "Move: WASD / arrows   Dash: Space   F8: leave a playtest note   F9: export playtest data"
	help.add_theme_font_size_override("font_size", 13)
	help.add_theme_color_override("font_color", Color(1, 1, 1, 0.7))
	help.anchor_top = 1.0
	help.anchor_bottom = 1.0
	help.offset_left = 16.0
	help.offset_top = -26.0
	hud.add_child(help)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(center)
	_panel = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.04, 0.08, 0.12, 0.92)
	style.set_corner_radius_all(12)
	style.set_content_margin_all(24)
	style.border_color = Color(0.4, 0.9, 1.0, 0.3)
	style.set_border_width_all(1)
	_panel.add_theme_stylebox_override("panel", style)
	_panel.visible = false
	center.add_child(_panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	_panel.add_child(box)
	_panel_title = Label.new()
	_panel_title.add_theme_font_size_override("font_size", 26)
	_panel_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_panel_title)
	_panel_text = Label.new()
	_panel_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_panel_text)
	_panel_buttons = HBoxContainer.new()
	_panel_buttons.add_theme_constant_override("separation", 10)
	_panel_buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_child(_panel_buttons)


func _show_panel(title: String, text: String, buttons: Array) -> void:
	_panel_title.text = title
	_panel_text.text = text
	for child in _panel_buttons.get_children():
		child.queue_free()
	for i in buttons.size():
		var button := Button.new()
		button.text = buttons[i]
		button.custom_minimum_size = Vector2(150, 64)
		button.tooltip_text = UPGRADES[_offer[i]]["text"]
		var upgrade_id := _offer[i]
		button.pressed.connect(func() -> void: _pick(upgrade_id))
		_panel_buttons.add_child(button)
	_panel.visible = true


func _update_status() -> void:
	if _level == null:
		return
	var hearts := ""
	for i in _lives:
		hearts += "♥ "
	var owned: Array[String] = []
	for upgrade_id in _upgrades:
		owned.append(UPGRADES[upgrade_id]["title"])
	_status.text = "REEF RUNNER  ·  Stage %d/3: %s  ·  %s ·  Pearls %d  ·  Build %s%s" % [
		_level_index + 1, _level.title, hearts, _pearls, build,
		("  ·  " + ", ".join(owned)) if not owned.is_empty() else ""]
