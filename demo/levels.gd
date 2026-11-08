extends RefCounted
## Level layouts for the Reef Runner demo. Each level is carved out of solid
## rock on a 36 x 20 grid of 32 px cells.
##
## Cell codes: "#" rock, "." water, "S" start, "E" exit, "^" sea urchin,
## "o" pearl, "J" jellyfish swarm, "K" kelp curtain (a hidden way through),
## "G" spike gate.

const WIDTH := 36
const HEIGHT := 20


class Builder:
	var cells: Array[String] = []
	var zones: Array[Dictionary] = []

	func _init() -> void:
		cells.resize(36 * 20)
		cells.fill("#")

	## Fills a rectangle of cells, never touching the outer wall.
	func carve(x: int, y: int, w: int, h: int, code: String = ".") -> Builder:
		for cy in range(y, y + h):
			for cx in range(x, x + w):
				if cx > 0 and cy > 0 and cx < 35 and cy < 19:
					cells[cy * 36 + cx] = code
		return self

	func put(points: Array, code: String) -> Builder:
		for point in points:
			cells[point.y * 36 + point.x] = code
		return self

	func zone(zone_name: String, x: int, y: int, w: int, h: int) -> Builder:
		zones.append({"name": zone_name, "rect": Rect2i(x, y, w, h)})
		return self

	func finish(id: String, title: String, palette: Dictionary) -> Dictionary:
		var rows := PackedStringArray()
		for y in 20:
			var row := ""
			for x in 36:
				row += cells[y * 36 + x]
			rows.append(row)
		return {"id": id, "title": title, "rows": rows, "zones": zones, "palette": palette}


static func all() -> Array[Dictionary]:
	return [shallows(), kelp_maze(), abyss()]


static func shallows() -> Dictionary:
	var b := Builder.new()
	b.carve(1, 1, 34, 18)
	b.carve(12, 1, 1, 6, "#").carve(5, 10, 7, 1, "#").carve(5, 11, 1, 4, "#")
	b.carve(19, 7, 6, 1, "#").carve(19, 8, 1, 3, "#").carve(24, 8, 1, 3, "#")
	b.carve(28, 2, 4, 2, "#").carve(31, 13, 1, 5, "#").carve(14, 14, 4, 1, "#")
	b.put([Vector2i(22, 3), Vector2i(23, 3), Vector2i(22, 4), Vector2i(23, 4), Vector2i(8, 7),
		Vector2i(16, 17), Vector2i(29, 9), Vector2i(23, 14), Vector2i(24, 14), Vector2i(25, 14)], "^")
	b.put([Vector2i(5, 3), Vector2i(17, 2), Vector2i(21, 9), Vector2i(9, 13), Vector2i(27, 16),
		Vector2i(33, 4), Vector2i(3, 17)], "o")
	b.put([Vector2i(2, 2)], "S").put([Vector2i(34, 16), Vector2i(34, 17)], "E")
	b.zone("Urchin Patch", 21, 2, 4, 4).zone("Coral Arch", 19, 7, 6, 4).zone("Lagoon Exit", 32, 14, 3, 5)
	return b.finish("shallows", "Shallows", {
		"water": Color("#0f4c63"), "floor": Color("#1f7a8c"), "rock": Color("#3d4b5c"), "rock_edge": Color("#5b6b7e"),
	})


static func kelp_maze() -> Dictionary:
	var b := Builder.new()
	b.carve(1, 1, 7, 7).carve(8, 3, 5, 2).carve(13, 1, 9, 6).carve(22, 3, 2, 2).carve(24, 1, 11, 6)
	b.carve(16, 7, 3, 3).carve(12, 10, 11, 4).carve(14, 10, 6, 4, "J")
	b.carve(2, 8, 3, 7).carve(1, 15, 8, 4).carve(5, 11, 7, 2)
	b.carve(23, 11, 4, 2).carve(24, 13, 2, 1).carve(23, 14, 5, 5).carve(29, 13, 6, 6)
	b.put([Vector2i(28, 16)], "K")
	b.put([Vector2i(4, 12), Vector2i(18, 2), Vector2i(30, 4), Vector2i(26, 17)], "^")
	b.put([Vector2i(5, 5), Vector2i(20, 5), Vector2i(27, 2), Vector2i(33, 5), Vector2i(3, 17),
		Vector2i(7, 16), Vector2i(23, 15), Vector2i(32, 17)], "o")
	b.put([Vector2i(2, 2)], "S").put([Vector2i(34, 15), Vector2i(34, 16)], "E")
	b.zone("Coral Cove", 24, 1, 11, 6).zone("Jelly Swarm", 14, 10, 6, 4).zone("Kelp Pocket", 23, 14, 5, 5)
	b.zone("Exit Grotto", 29, 13, 6, 6)
	return b.finish("kelp_maze", "Kelp Maze", {
		"water": Color("#0b3d3a"), "floor": Color("#16695f"), "rock": Color("#2f4a3f"), "rock_edge": Color("#4b6b5a"),
	})


static func abyss() -> Dictionary:
	var b := Builder.new()
	b.carve(1, 1, 7, 6).carve(8, 3, 12, 2).carve(20, 1, 8, 8).carve(23, 9, 2, 3)
	b.carve(14, 12, 10, 4).carve(24, 13, 5, 1).carve(25, 13, 2, 1, "G").carve(29, 10, 6, 9)
	b.carve(3, 7, 2, 1).carve(2, 8, 10, 9)
	b.put([Vector2i(11, 3), Vector2i(14, 4), Vector2i(17, 3), Vector2i(22, 4), Vector2i(23, 4),
		Vector2i(24, 6), Vector2i(21, 7), Vector2i(26, 3), Vector2i(17, 14), Vector2i(6, 12)], "^")
	b.put([Vector2i(4, 4), Vector2i(26, 7), Vector2i(4, 15), Vector2i(10, 10), Vector2i(15, 13),
		Vector2i(32, 12)], "o")
	b.put([Vector2i(2, 2)], "S").put([Vector2i(34, 16), Vector2i(34, 17)], "E")
	b.zone("Urchin Tunnel", 8, 3, 12, 2).zone("Abyss Cavern", 20, 1, 8, 8).zone("Sunken Grotto", 2, 8, 10, 9)
	b.zone("Spike Gate", 24, 13, 5, 1).zone("Escape Cave", 29, 10, 6, 9)
	return b.finish("abyss", "Abyss", {
		"water": Color("#060d1f"), "floor": Color("#13284a"), "rock": Color("#1d2433"), "rock_edge": Color("#2f3a52"),
	})
