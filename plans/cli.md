# Проблемы и путь развития CLI (`npx kadmium`)

> Created 2026-09-08 — CLI rework (init/generate/check) + bin runner fix.

---

## H5: Мёртвые example-скрипты и отсталый init

**Важность:** 🟢 Low

**Статус:** ✅ Решено в этом PR — логика загрузки проекта вынесена в публичный `loadCodegenProject()`, добавлена команда `check`, `init` переписан на рабочий цикл.

**Что сделано:**
- Удалены мёртвые `codegen/_example.ts`, `codegen/check.ts` (не типизировались, `src/codegen` в `exclude`).
- Новый публичный API: `loadCodegenProject(dir)` → `{ config, irs, modelPaths, output }`, export из `src/index.ts` вместе с `generateToFile`/`checkSync`.
- `kadmium generate` переведён на `loadCodegenProject`.
- Новая команда `kadmium check` (валидирует сгенерированные типы, exit 1 при устаревании).
- `init` создаёт рабочий шаблон: `kadmium.config.ts`, тонкие `scripts/generate-types.ts`/`check-types.ts`, `.types/.gitkeep`, package.json → `kadmium generate/check`. Консистентность CLI ↔ npm-скрипты: оба пути вызывают одни и те же публичные функции.

**Связанные файлы:**
- `packages/core/src/core/codegen-project.ts` (loadCodegenProject)
- `packages/core/src/cli/generate.ts`, `packages/core/src/cli/check.ts`, `packages/core/src/cli/init.ts`
- `packages/core/src/codegen/runner.ts` (API не менялся)

---

## Bin runner: ts-node + TS5011 (rootDir)

**Важность:** 🔴 Critical

**Краткое описание:** `bin/kadmium.js` регистрирует ts-node с tsconfig текущей директории, но должен компилировать TS и ядра (вне проекта), и пользовательские файлы (config/models). Один tsconfig не покрывает оба дерева → `TS5011: rootDir must be explicitly set`.

Дополнительно усугубляет: пакеты публикуются «из src» — `main: "src/index.ts"` (core, sql-pg). Любой импорт пользовательских TS тянет TS-исходники пакетов под чужой tsconfig.

**Текущее решение (dev-хак):** `ignoreDiagnostics: [5011]` в регистрации ts-node + `transpileOnly`. Каждый `.ts` транслируется per-file без rootDir-проверки. Работает из любого cwd, для всех команд (`generate`, `check`, `db:*`). См. TODO в `packages/core/bin/kadmium.js`.

**PR-B (production readiness) — замена хака:**
1. Все пакеты (core, sql-pg, sql-types) собираются в `dist`.
2. `main`/`types`/`bin` → `dist/...` (`bin` → `dist/src/bin/kadmium.js`).
3. Регистрация ts-node переезжает в `src/bin/kadmium.ts` — тогда компилируются только пользовательские файлы (они внутри его проекта, rootDir корректен); TODO-комментарий удаляется.
4. Решить судьбу `ts-node` как зависимости (сейчас devDep помещён на корне; для потребителей bin должен стать `dependencies`).
5. Бонус: `--version`, унифицированные exit codes, README-скаффолд, пример модели с relations.

**Связанные файлы:**
- `packages/core/bin/kadmium.js` (хак + TODO)
- `packages/core/package.json` (bin → dist, потом main/types)
- `packages/sql-pg/package.json` (main → dist)
- `packages/sql-types/package.json` (main → dist)

---

## Открытые улучшения (не срочные)

- **db:\*** — дефолтные пути, возможно `db:diff`; unified loader для db-команд.
- Отсутствует README в скаффолде `init`.
- `--help` по командам отсутствует (только общий).