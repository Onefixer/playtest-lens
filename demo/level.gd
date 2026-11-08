extends Node2D
## One Reef Runner level, built from a layout in levels.gd. Draws itself,
## creates the rock collision, and adds named zones for Playtest Lens.

const CELL := 32
const WIDTH := 36
const HEIGHT := 20

var level_id := ""
var title := ""
var rows := PackedStringArray()
var palette := {}
var dark := false
var start_position := Vector2.ZERO
var urchins: Array[Vector2] = []
var pearls: Array[Vector2i] = []
var gate_cells: Array[Vector2i] = []
var exit_cells: Array[Vector2i] = []
var kelp_cells: Array[Vector2i] = []
var jelly_area := Rect2()
var time := 0.0

# Build differences, used to show the dashboard's build comparison.
var gate_open_time := 1.1
var gate_closed_time := 1.6
var gate_telegraph := 0.45
var kelp_hint := true

var _jellies: Array[Dictionary] = []


func setup(layout: Dictionary, build: String) -> void:
	level_id = layout["id"]
	title = layout["title"]
	rows = layout["rows"]
	palette = layout["palette"]
	dark = level_id == "abyss"
	name = level_id
	if build == "0.3":
		gate_open_time = 0.6
		gate_closed_time = 2.2
		gate_telegraph = 0.0
		kelp_hint = false
	_parse()
	_build_collision()
	_build_zones(layout["zones"])


func _process(delta: float) -> void:
	time += delta
	queue_redraw()


## Exact level area for Playtest Lens map captures.
func get_playtest_bounds() -> Rect2:
	return global_transform * Rect2(0, 0, WIDTH * CELL, HEIGHT * CELL)


func cell_of(pos: Vector2) -> Vector2i:
	return Vector2i(clampi(int(pos.x / CELL), 0, WIDTH - 1), clampi(int(pos.y / CELL), 0, HEIGHT - 1))


func cell_center(cell: Vector2i) -> Vector2:
	return Vector2(cell) * CELL + Vector2(CELL, CELL) / 2.0


func code_at(cell: Vector2i) -> String:
	if cell.x < 0 or cell.y < 0 or cell.x >= WIDTH or cell.y >= HEIGHT:
		return "#"
	return rows[cell.y][cell.x]


func has_kelp() -> bool:
	return not kelp_cells.is_empty()


func is_gate_closed() -> bool:
	if gate_cells.is_empty():
		return false
	return fmod(time, gate_open_time + gate_closed_time) < gate_closed_time


## Seconds until an open gate closes again (0 while closed).
func gate_time_left_open() -> float:
	if is_gate_closed():
		return 0.0
	var cycle := gate_open_time + gate_closed_time
	return cycle - fmod(time, cycle)


func jelly_positions() -> Array[Vector2]:
	var out: Array[Vector2] = []
	for jelly in _jellies:
		var base: Vector2 = jelly["base"]
		var t: float = time * jelly["speed"] + jelly["phase"]
		out.append(base + Vector2(sin(t) * jelly["ax"], cos(t * 0.7) * jelly["ay"]))
	return out


## What would kill a diver of this radius at this position ("" if nothing).
func hazard_at(pos: Vector2, radius: float) -> String:
	for urchin in urchins:
		if pos.distance_to(urchin) < radius + 8.0:
			return "urchin"
	if is_gate_closed():
		for cell in gate_cells:
			var rect := Rect2(Vector2(cell) * CELL, Vector2(CELL, CELL)).grow(-3.0)
			var closest := pos.clamp(rect.position, rect.end)
			if pos.distance_to(closest) < radius:
				return "spike_gate"
	if jelly_area.grow(radius).has_point(pos):
		for jelly in jelly_positions():
			if pos.distance_to(jelly) < radius + 11.0:
				return "jellyfish"
	return ""


func take_pearl(pos: Vector2, reach: float) -> bool:
	for i in pearls.size():
		if pos.distance_to(cell_center(pearls[i])) < reach:
			pearls.remove_at(i)
			return true
	return false


func is_exit(pos: Vector2) -> bool:
	return exit_cells.has(cell_of(pos))


func _parse() -> void:
	var jelly_cells: Array[Vector2i] = []
	for y in HEIGHT:
		for x in WIDTH:
			var cell := Vector2i(x, y)
			match code_at(cell):
				"S":
					start_position = cell_center(cell)
				"^":
					urchins.append(cell_center(cell))
				"o":
					pearls.append(cell)
				"G":
					gate_cells.append(cell)
				"E":
					exit_cells.append(cell)
				"K":
					kelp_cells.append(cell)
				"J":
					jelly_cells.append(cell)
	if not jelly_cells.is_empty():
		jelly_area = Rect2(Vector2(jelly_cells[0]) * CELL, Vector2.ZERO)
		for cell in jelly_cells:
			jelly_area = jelly_area.expand(Vector2(cell + Vector2i.ONE) * CELL)
		var rng := RandomNumberGenerator.new()
		rng.seed = 7
		for i in 7:
			_jellies.append({
				"base": jelly_area.position + Vector2(rng.randf_range(0.15, 0.85) * jelly_area.size.x, rng.randf_range(0.2, 0.8) * jelly_area.size.y),
				"ax": rng.randf_range(10.0, 34.0),
				"ay": rng.randf_range(8.0, 26.0),
				"speed": rng.randf_range(0.5, 1.2),
				"phase": rng.randf_range(0.0, TAU),
			})


func _build_collision() -> void:
	var body := StaticBody2D.new()
	body.name = "Rock"
	add_child(body)
	# One rectangle per horizontal run of rock keeps the shape count low.
	for y in HEIGHT:
		var x := 0
		while x < WIDTH:
			if code_at(Vector2i(x, y)) != "#":
				x += 1
				continue
			var run_start := x
			while x < WIDTH and code_at(Vector2i(x, y)) == "#":
				x += 1
			var shape := RectangleShape2D.new()
			shape.size = Vector2((x - run_start) * CELL, CELL)
			var collider := CollisionShape2D.new()
			collider.shape = shape
			collider.position = Vector2(run_start * CELL + shape.size.x / 2.0, y * CELL + CELL / 2.0)
			body.add_child(collider)


func _build_zones(zones: Array) -> void:
	for zone in zones:
		var rect: Rect2i = zone["rect"]
		var area := Area2D.new()
		area.name = String(zone["name"]).replace(" ", "")
		area.set_meta("zone_name", zone["name"])
		area.monitoring = false
		area.monitorable = false
		area.add_to_group("playtest_zone")
		var shape := RectangleShape2D.new()
		shape.size = Vector2(rect.size) * CELL
		var collider := CollisionShape2D.new()
		collider.shape = shape
		collider.position = Vector2(rect.position) * CELL + shape.size / 2.0
		area.add_child(collider)
		add_child(area)


# --- Drawing ------------------------------------------------------------------

func _draw() -> void:
	var water: Color = palette["water"]
	var floor_color: Color = palette["floor"]
	var rock: Color = palette["rock"]
	var rock_edge: Color = palette["rock_edge"]
	draw_rect(Rect2(0, 0, WIDTH * CELL, HEIGHT * CELL), water)
	for y in HEIGHT:
		for x in WIDTH:
			var cell := Vector2i(x, y)
			var rect := Rect2(Vector2(cell) * CELL, Vector2(CELL, CELL))
			var code := code_at(cell)
			var noise := _hash(x, y)
			if code == "#":
				draw_rect(rect, rock.lerp(rock_edge, noise * 0.35))
				if code_at(cell + Vector2i(0, 1)) != "#":
					draw_rect(Rect2(rect.position + Vector2(0, CELL - 5), Vector2(CELL, 5)), rock_edge)
				continue
			draw_rect(rect, floor_color.lerp(water, 0.18 + noise * 0.22))
			if noise > 0.82:
				draw_circle(rect.position + Vector2(8 + noise * 14, 10 + noise * 12), 1.6, floor_color.lightened(0.35))
			match code:
				"K":
					_draw_kelp_curtain(rect)
				"G":
					_draw_gate(rect)
				"E":
					var glow := 0.55 + 0.25 * sin(time * 3.0)
					draw_rect(rect, Color(0.3, 0.95, 0.9, glow * 0.6))
					draw_rect(rect.grow(-8), Color(0.75, 1.0, 0.95, glow))
				"S":
					draw_arc(rect.get_center(), 11, 0, TAU, 24, Color(1, 1, 1, 0.35), 2.0)
	for cell in pearls:
		var center := cell_center(cell)
		draw_circle(center, 6.0, Color("#f4f1e8"))
		draw_circle(center + Vector2(-2, -2), 2.0, Color.WHITE)
	for urchin in urchins:
		_draw_urchin(urchin)
	for jelly in jelly_positions():
		_draw_jelly(jelly)


func _draw_urchin(center: Vector2) -> void:
	var spikes := 12
	for i in spikes:
		var angle := TAU * i / spikes + time * 0.2
		draw_line(center, center + Vector2.from_angle(angle) * 13.0, Color("#b35cff"), 2.0)
	draw_circle(center, 7.0, Color("#5b2a86"))
	draw_circle(center, 3.0, Color("#d9a6ff"))


func _draw_jelly(center: Vector2) -> void:
	var pulse := 1.0 + 0.12 * sin(time * 4.0 + center.x)
	for i in 4:
		var x := center.x - 6 + i * 4
		draw_line(Vector2(x, center.y + 2), Vector2(x + sin(time * 3 + i) * 3, center.y + 15), Color(1, 0.6, 0.85, 0.6), 1.5)
	draw_circle(center, 9.0 * pulse, Color(1, 0.55, 0.85, 0.75))
	draw_circle(center + Vector2(-2, -3), 3.0, Color(1, 0.9, 0.97, 0.9))


func _draw_gate(rect: Rect2) -> void:
	var closed := is_gate_closed()
	var warning := not closed and gate_telegraph > 0.0 and gate_time_left_open() < gate_telegraph
	var color := Color("#ff4d4d")
	if warning:
		color = Color("#ffb020") if fmod(time, 0.16) < 0.08 else Color("#ff4d4d")
	elif not closed:
		color = Color(1, 0.3, 0.3, 0.25)
	for i in 4:
		var x := rect.position.x + 4 + i * 8
		if closed or warning:
			draw_line(Vector2(x, rect.position.y + 2), Vector2(x, rect.end.y - 2), color, 3.0)
		else:
			draw_line(Vector2(x, rect.position.y + 2), Vector2(x, rect.position.y + 6), color, 3.0)
			draw_line(Vector2(x, rect.end.y - 6), Vector2(x, rect.end.y - 2), color, 3.0)


func _draw_kelp_curtain(rect: Rect2) -> void:
	draw_rect(rect, Color(palette["rock"]).lerp(Color("#1f5f3a"), 0.6))
	for i in 5:
		var x := rect.position.x + 3 + i * 6.5
		draw_line(Vector2(x, rect.end.y), Vector2(x + sin(time * 1.5 + i) * 3, rect.position.y), Color("#3fa46a"), 3.0)
	if kelp_hint:
		# Build 0.4: a little school of glowing fish hints at the passage.
		for i in 3:
			var p := rect.get_center() + Vector2(cos(time * 2.0 + i * 2.1) * 26, sin(time * 2.0 + i * 2.1) * 12)
			draw_circle(p, 2.5, Color(1, 0.92, 0.4, 0.9))


static func _hash(x: int, y: int) -> float:
	var h := (x * 374761393 + y * 668265263) & 0x7fffffff
	h = (h ^ (h >> 13)) * 1274126177 & 0x7fffffff
	return float(h % 1000) / 1000.0
