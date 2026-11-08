extends CharacterBody2D
## The player's diver. Reads the move/dash actions, so bots drive it the same
## way a person does.

signal dashed

const RADIUS := 10.0

var base_speed := 170.0
var speed_multiplier := 1.0
var invulnerable := 0.0

var _dash_left := 0.0
var _dash_cooldown := 0.0
var _facing := Vector2.RIGHT


func _ready() -> void:
	motion_mode = CharacterBody2D.MOTION_MODE_FLOATING
	var shape := CircleShape2D.new()
	shape.radius = RADIUS
	var collider := CollisionShape2D.new()
	collider.shape = shape
	add_child(collider)


func can_dash() -> bool:
	return _dash_cooldown <= 0.0


func _physics_process(delta: float) -> void:
	var input := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if Input.is_action_just_pressed("dash") and can_dash() and input != Vector2.ZERO:
		_dash_left = 0.18
		_dash_cooldown = 0.8
		dashed.emit()
	var speed := base_speed * speed_multiplier * (2.2 if _dash_left > 0.0 else 1.0)
	velocity = velocity.lerp(input * speed, 1.0 - exp(-delta * 14.0))
	if input.length() > 0.1:
		_facing = input.normalized()
	move_and_slide()
	_dash_left = maxf(0.0, _dash_left - delta)
	_dash_cooldown = maxf(0.0, _dash_cooldown - delta)
	invulnerable = maxf(0.0, invulnerable - delta)
	queue_redraw()


func stop() -> void:
	velocity = Vector2.ZERO
	_dash_left = 0.0


func _draw() -> void:
	var alpha := 0.45 if invulnerable > 0.0 and fmod(invulnerable, 0.2) < 0.1 else 1.0
	if _dash_left > 0.0:
		draw_circle(-_facing * 10.0, RADIUS * 0.8, Color(0.6, 0.95, 1.0, 0.35))
	draw_circle(Vector2.ZERO, RADIUS + 2.0, Color(0, 0, 0, 0.25 * alpha))
	draw_circle(Vector2.ZERO, RADIUS, Color(1.0, 0.72, 0.25, alpha))
	draw_circle(_facing * 4.0, 4.5, Color(0.12, 0.2, 0.3, alpha))
	draw_circle(_facing * 4.0 + Vector2(-1.2, -1.2), 1.5, Color(0.8, 0.95, 1.0, alpha))
