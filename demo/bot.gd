extends Node
## A simulated playtester for the Reef Runner demo.
##
## It presses the same input actions a person would, with its own skill,
## curiosity and patience. That lets the demo produce believable playtest
## data in seconds: bots get stuck in the Kelp Pocket until they find the
## hidden passage, mistime the Spike Gate, wander into urchins in the dark,
## leave notes and quit when frustrated.

const LevelNode := preload("level.gd")
const UPGRADE_WEIGHTS := {"lantern": 0.42, "swift_fins": 0.33, "thick_shell": 0.22, "lucky_pearl": 0.03}
const DIAGONAL := 1.4142

var game
var skill := 0.6
var curiosity := 0.5
var patience := 4.0
var reaction := 0.5
var budget := 300.0
var frustration := 0.0

var _rng := RandomNumberGenerator.new()
var _level: LevelNode
var _diver: CharacterBody2D
var _path: Array[Vector2] = []
var _mode := "travel"
var _knows_kelp := false
var _goal := Vector2i(-1, -1)
var _repath := 0.0
var _wander_center := Vector2i.ZERO
var _wander_timer := 0.0
var _wander_time := 0.0
var _gate_seen_open := false
var _gate_wait := 0.0
var _cross_target := Vector2.ZERO
var _wobble := Vector2.ZERO
var _stuck_check_pos := Vector2.ZERO
var _stuck_check_timer := 0.0
var _deaths := {}
var _last_cause := ""
var _noted := {}
var _quit_timer := 0.0
var _seen_jelly := false


func _ready() -> void:
	process_physics_priority = -10


func setup(game_node: Node, seed_value: int) -> void:
	game = game_node
	_rng.seed = seed_value
	skill = _rng.randf_range(0.3, 0.95)
	curiosity = _rng.randf_range(0.2, 0.9)
	patience = _rng.randf_range(3.0, 8.0)
	reaction = lerpf(0.75, 0.32, skill)
	budget = _rng.randf_range(300.0, 900.0)


func on_level_loaded(level: LevelNode, diver: CharacterBody2D) -> void:
	_level = level
	_diver = diver
	_knows_kelp = false
	_wander_time = 0.0
	_reset_route()


func on_respawn() -> void:
	_reset_route()


func on_death(cause: String) -> void:
	_deaths[cause] = int(_deaths.get(cause, 0)) + 1
	frustration += 0.6 + (0.5 if cause == _last_cause else 0.0)
	_last_cause = cause
	if cause == "spike_gate":
		reaction = maxf(0.22, reaction * 0.9)
		if _deaths[cause] >= 2 and game.build == "0.3":
			_note_once("gate", 0.45, ["the gate closes way too fast", "no way to tell when the spike gate is about to shut", "this gate is impossible?!"])
	elif cause == "urchin" and _level != null and _level.dark and not game.has_upgrade("lantern"):
		_note_once("dark", 0.25, ["can't see the urchins down here", "way too dark in the abyss"])


func on_run_won() -> void:
	_note_once("won", 0.4, ["made it out! the abyss was tense but fun", "fun run, the kelp maze took me a while"])


func pick_upgrade(options: Array) -> String:
	var total := 0.0
	for option in options:
		total += float(UPGRADE_WEIGHTS.get(option, 0.1))
	var roll := _rng.randf() * total
	for option in options:
		roll -= float(UPGRADE_WEIGHTS.get(option, 0.1))
		if roll <= 0.0:
			return option
	return options[0]


func wants_another_run() -> bool:
	return frustration < patience and game.sim_time < budget


func _physics_process(delta: float) -> void:
	_quit_timer += delta
	if _quit_timer >= 1.0:
		_quit_timer = 0.0
		_check_quit()
	if game.state != "play" or _level == null:
		_release_all()
		return
	frustration = maxf(0.0, frustration - delta * 0.02)
	var pos := _diver.global_position
	var dir := Vector2.ZERO
	var strength := 1.0
	match _mode:
		"gate":
			dir = _gate_logic(delta, pos)
		"cross":
			dir = (_cross_target - pos).normalized()
			if pos.distance_to(_cross_target) < 8.0:
				_mode = "travel"
				_reset_route()
		"wander":
			dir = _wander_logic(delta, pos)
		_:
			dir = _travel_logic(delta, pos)

	_wobble = _wobble.lerp(Vector2.from_angle(_rng.randf() * TAU) * _wobble_amount(), clampf(delta * 3.0, 0.0, 1.0))
	if _mode != "gate" and _mode != "cross":
		dir += _wobble + _avoidance(pos)
	if _level.jelly_area.has_point(pos):
		strength = 0.55
		if not _seen_jelly:
			_seen_jelly = true
			if game.build == "0.3":
				_note_once("lag", 0.35, ["it gets really choppy around the jellyfish", "big lag spike in the jelly room"])
	_unstick(delta, pos)
	_set_move(dir.normalized() * strength if dir.length() > 0.05 else Vector2.ZERO)


func _travel_logic(delta: float, pos: Vector2) -> Vector2:
	_repath -= delta
	if _path.is_empty() or _repath <= 0.0:
		_plan(pos)
	if _path.is_empty():
		return Vector2.ZERO
	var next := _path[0]
	if _level.code_at(_level.cell_of(next)) == "G" and not _level.gate_cells.is_empty():
		_mode = "gate"
		_gate_seen_open = false
		return Vector2.ZERO
	if pos.distance_to(next) < 9.0:
		_path.pop_front()
		if _path.is_empty():
			_arrived()
	return (next - pos).normalized()


## Waits in front of the Spike Gate for it to open, reacts, then dashes across.
func _gate_logic(delta: float, pos: Vector2) -> Vector2:
	var gate: Vector2i = _level.gate_cells[0]
	var approach: Vector2 = _level.cell_center(gate - Vector2i(1, 0))
	_cross_target = _level.cell_center(_level.gate_cells[-1] + Vector2i(1, 0))
	if pos.distance_to(approach) > 5.0:
		return (approach - pos).normalized() * 0.6
	if _level.is_gate_closed():
		_gate_seen_open = false
		return Vector2.ZERO
	if not _gate_seen_open:
		_gate_seen_open = true
		_gate_wait = clampf(_rng.randfn(reaction, 0.12), 0.1, 1.5)
	_gate_wait -= delta
	if _gate_wait > 0.0:
		return Vector2.ZERO
	# Careful players heed the warning flash in build 0.4 and wait it out.
	if _level.gate_telegraph > 0.0 and skill > 0.45 and _level.gate_time_left_open() < 0.42:
		return Vector2.ZERO
	_mode = "cross"
	Input.action_press("dash")
	return (_cross_target - pos).normalized()


## Lost in a dead end: roam around it until the hidden way through is found.
func _wander_logic(delta: float, pos: Vector2) -> Vector2:
	_wander_time += delta
	frustration += delta * 0.03
	var chance := (0.022 + 0.05 * curiosity) * (3.0 if _level.kelp_hint else 1.0)
	if _rng.randf() < chance * delta:
		_knows_kelp = true
		PlaytestLens.event("found_passage")
		_mode = "travel"
		_reset_route()
		return Vector2.ZERO
	if _wander_time > 22.0:
		_note_once("lost", 0.4, ["how do I get out of this room?", "I think I'm lost, everything is a dead end", "is there a way forward from here?"])
	_wander_timer -= delta
	if _path.is_empty() or _wander_timer <= 0.0:
		_wander_timer = _rng.randf_range(1.2, 2.8)
		var options := _reachable_near(_wander_center, 3)
		if not options.is_empty():
			_path = _find_path(_level.cell_of(pos), options[_rng.randi() % options.size()])
	if _path.is_empty():
		return Vector2.ZERO
	if pos.distance_to(_path[0]) < 9.0:
		_path.pop_front()
		return Vector2.ZERO
	return (_path[0] - pos).normalized()


func _plan(pos: Vector2) -> void:
	_repath = 1.5
	var here: Vector2i = _level.cell_of(pos)
	if _goal == Vector2i(-1, -1):
		_goal = _choose_goal(here)
	_path = _find_path(here, _goal)
	if _path.is_empty() and _goal != _exit_cell():
		_goal = _exit_cell()
		_path = _find_path(here, _goal)
	if _path.is_empty():
		# The exit looks unreachable: head for the closest spot and look around.
		var frontier := _closest_reachable(here, _exit_cell())
		_path = _find_path(here, frontier)
		if _path.is_empty() or Vector2(here).distance_to(Vector2(frontier)) < 1.5:
			_mode = "wander"
			_wander_center = frontier
			_path.clear()


func _arrived() -> void:
	if _goal == _exit_cell():
		return
	_goal = Vector2i(-1, -1)
	_repath = 0.0


func _choose_goal(here: Vector2i) -> Vector2i:
	if _rng.randf() < curiosity * 0.55:
		var best := Vector2i(-1, -1)
		var best_distance := 9.0
		for pearl in _level.pearls:
			var distance := Vector2(here).distance_to(Vector2(pearl))
			if distance < best_distance:
				best = pearl
				best_distance = distance
		if best != Vector2i(-1, -1):
			return best
	return _exit_cell()


func _exit_cell() -> Vector2i:
	return _level.exit_cells[0]


func _reset_route() -> void:
	_path.clear()
	_goal = Vector2i(-1, -1)
	_repath = 0.0
	if _mode != "wander" or _knows_kelp:
		_mode = "travel"


func _wobble_amount() -> float:
	var amount := (1.0 - skill) * 0.45
	if _level.dark and not game.has_upgrade("lantern"):
		amount += 0.3
	return amount


func _avoidance(pos: Vector2) -> Vector2:
	var push := Vector2.ZERO
	var sees: bool = not _level.dark or game.has_upgrade("lantern")
	if sees:
		for urchin in _level.urchins:
			var d := pos.distance_to(urchin)
			if d < 40.0 and d > 0.1:
				push += (pos - urchin).normalized() * (40.0 - d) / 40.0 * skill * 0.9
	if _level.jelly_area.grow(40.0).has_point(pos):
		for jelly in _level.jelly_positions():
			var d := pos.distance_to(jelly)
			if d < 56.0 and d > 0.1:
				push += (pos - jelly).normalized() * (56.0 - d) / 56.0 * (0.1 + 0.6 * skill)
	return push


func _unstick(delta: float, pos: Vector2) -> void:
	_stuck_check_timer += delta
	if _stuck_check_timer < 1.5:
		return
	if pos.distance_to(_stuck_check_pos) < 6.0 and _mode == "travel" and not _path.is_empty():
		_path.clear()
		_repath = 0.0
		_wobble = Vector2.from_angle(_rng.randf() * TAU)
	_stuck_check_pos = pos
	_stuck_check_timer = 0.0


func _check_quit() -> void:
	if game.state == "quit":
		return
	if frustration > patience:
		_note_once("quit", 0.5, ["too frustrating, stopping here", "giving up for now", "I'll try again later"])
		game.quit_session()
	elif game.sim_time > budget + 200.0:
		game.quit_session()


func _note_once(key: String, chance: float, lines: Array) -> void:
	if _noted.has(key):
		return
	_noted[key] = true
	if _rng.randf() < chance:
		PlaytestLens.feedback(lines[_rng.randi() % lines.size()])


func _set_move(dir: Vector2) -> void:
	_press("move_right", maxf(dir.x, 0.0))
	_press("move_left", maxf(-dir.x, 0.0))
	_press("move_down", maxf(dir.y, 0.0))
	_press("move_up", maxf(-dir.y, 0.0))
	if Input.is_action_pressed("dash") and _mode != "cross":
		Input.action_release("dash")


func _press(action: String, strength: float) -> void:
	if strength > 0.05:
		Input.action_press(action, strength)
	else:
		Input.action_release(action)


func _release_all() -> void:
	for action in ["move_left", "move_right", "move_up", "move_down", "dash"]:
		Input.action_release(action)


# --- Path finding on the level grid ------------------------------------------

func _passable(cell: Vector2i) -> bool:
	var code: String = _level.code_at(cell)
	return code != "#" and (code != "K" or _knows_kelp)


func _cost(cell: Vector2i) -> float:
	match _level.code_at(cell):
		"^":
			if _level.dark and not game.has_upgrade("lantern"):
				return 1.6
			return lerpf(3.0, 16.0, skill)
		"J":
			return 2.5
	return 1.0


func _find_path(from: Vector2i, to: Vector2i) -> Array[Vector2]:
	var result: Array[Vector2] = []
	if not _passable(to):
		return result
	var w := 36
	var count := 36 * 20
	var dist := PackedFloat32Array()
	dist.resize(count)
	dist.fill(INF)
	var prev := PackedInt32Array()
	prev.resize(count)
	prev.fill(-1)
	var done := PackedByteArray()
	done.resize(count)
	var start := from.y * w + from.x
	var goal := to.y * w + to.x
	dist[start] = 0.0
	var open: Array[int] = [start]
	while not open.is_empty():
		var best_i := 0
		for i in open.size():
			if dist[open[i]] < dist[open[best_i]]:
				best_i = i
		var current := open[best_i]
		open.remove_at(best_i)
		if current == goal:
			break
		if done[current] == 1:
			continue
		done[current] = 1
		var cell := Vector2i(current % w, current / w)
		for dy in [-1, 0, 1]:
			for dx in [-1, 0, 1]:
				if dx == 0 and dy == 0:
					continue
				var next := cell + Vector2i(dx, dy)
				if not _passable(next):
					continue
				if dx != 0 and dy != 0:
					if not _passable(cell + Vector2i(dx, 0)) or not _passable(cell + Vector2i(0, dy)):
						continue
				var index := next.y * w + next.x
				var step := _cost(next) * (DIAGONAL if dx != 0 and dy != 0 else 1.0)
				if dist[current] + step < dist[index]:
					dist[index] = dist[current] + step
					prev[index] = current
					open.append(index)
	if prev[goal] == -1 and goal != start:
		return result
	var index := goal
	while index != start and index != -1:
		result.push_front(_level.cell_center(Vector2i(index % w, index / w)))
		index = prev[index]
	return result


func _closest_reachable(from: Vector2i, target: Vector2i) -> Vector2i:
	var best := from
	var best_distance := INF
	for cell in _flood(from, 99):
		var distance := Vector2(cell).distance_to(Vector2(target))
		if distance < best_distance:
			best = cell
			best_distance = distance
	return best


func _reachable_near(center: Vector2i, radius: int) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for cell in _flood(center, radius):
		if _level.code_at(cell) != "^":
			out.append(cell)
	return out


func _flood(from: Vector2i, max_steps: int) -> Array[Vector2i]:
	var seen := {from: 0}
	var queue: Array[Vector2i] = [from]
	var out: Array[Vector2i] = []
	while not queue.is_empty():
		var cell: Vector2i = queue.pop_front()
		out.append(cell)
		var steps: int = seen[cell]
		if steps >= max_steps:
			continue
		for offset in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var next: Vector2i = cell + offset
			if not seen.has(next) and _passable(next):
				seen[next] = steps + 1
				queue.append(next)
	return out
