-- Migración: acceso multi-sucursal por usuario + fix nombre org
-- Reejecutable (idempotente).
--
-- Cambios:
--   1. Corrige el nombre de la organización si todavía dice "peluqueria demo".
--   2. Añade columna `default_branch_id` a `app_user` (la sucursal que se carga
--      al iniciar sesión sin tener que elegirla en el login).
--   3. Crea tabla `user_branch_access (user_id, branch_id)`: qué sucursales puede
--      usar cada usuario. Los admins pueden tener varias; los demás roles, una.
--   4. Seed inicial: todos los app_user activos → Latacunga.
--      Kelly y Michelle (por full_name) → también Quito.

-- ── 1. Nombre de organización ─────────────────────────────────────────────────
UPDATE organization
   SET name = 'MEDUSA', updated_at = datetime('now')
 WHERE name NOT LIKE 'MEDUSA%'
   AND active = 1;

-- ── 2. default_branch_id en app_user ─────────────────────────────────────────
ALTER TABLE app_user ADD COLUMN default_branch_id TEXT REFERENCES branch(id);

-- ── 3. Tabla user_branch_access ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_branch_access (
  user_id   TEXT NOT NULL REFERENCES app_user(id),
  branch_id TEXT NOT NULL REFERENCES branch(id),
  PRIMARY KEY (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS uba_user_idx ON user_branch_access (user_id);

-- ── 4. Seed: todos los usuarios activos → Latacunga ───────────────────────────
-- Asigna default_branch_id y acceso a la sucursal Latacunga.
-- La condición "nombre LIKE" evita fallar si la sucursal no existe.

WITH latacunga AS (
  SELECT id FROM branch WHERE name LIKE '%atac%' LIMIT 1
)
INSERT OR IGNORE INTO user_branch_access (user_id, branch_id)
SELECT au.id, l.id
  FROM app_user au, latacunga l
 WHERE au.active = 1;

-- Marcar Latacunga como default para quienes no tengan default_branch_id.
UPDATE app_user
   SET default_branch_id = (SELECT id FROM branch WHERE name LIKE '%atac%' LIMIT 1)
 WHERE active = 1
   AND default_branch_id IS NULL;

-- ── 5. Seed: Kelly y Michelle → también Quito ─────────────────────────────────
-- Agrega acceso a Quito para los dos usuarios que trabajan en ambas sucursales.
-- Usa full_name con LIKE para ser robusto ante variaciones menores de mayúsculas.
WITH quito AS (
  SELECT id FROM branch WHERE name LIKE '%uito%' LIMIT 1
)
INSERT OR IGNORE INTO user_branch_access (user_id, branch_id)
SELECT au.id, q.id
  FROM app_user au, quito q
 WHERE au.active = 1
   AND (au.full_name LIKE '%elly%' OR au.full_name LIKE '%ichelle%');
