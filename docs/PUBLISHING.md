# Publishing Playtest Lens

## 1. Put it on GitHub

1. Create an empty repository on github.com (for example `playtest-lens`). Don't add a README; this one already has one.
2. In this folder, run:

   ```bash
   git remote add origin https://github.com/<you>/playtest-lens.git
   git push -u origin main
   ```

   The project is already a git repository with a first commit. To start fresh instead, run `git init`, `git add .` and `git commit -m "Playtest Lens 1.0"` first.
3. On GitHub, add a short description, the topics `godot`, `godot-plugin`, `gamedev`, `analytics` and `playtesting`, and the screenshots from `docs/`.
4. Create a release: **Releases → Draft a new release**, tag `v1.0.0`.

## 2. Submit it to the Godot Asset Library

1. Sign in at https://godotengine.org/asset-library/asset and choose **Submit Asset**.
2. Fill in:
   - **Category:** Tools. **Godot version:** 4.3. **License:** MIT.
   - **Repository host:** GitHub, with your repository URL.
   - **Download commit:** the full commit hash of your release (`git rev-parse HEAD`).
   - **Icon URL:** the raw URL of `addons/playtest_lens/icon.png`, for example `https://raw.githubusercontent.com/<you>/playtest-lens/main/addons/playtest_lens/icon.png`.
   - **Previews:** raw URLs of the images in `docs/`.
3. Moderators review submissions, usually within a few days. The library installs only the `addons/` folder, so the demo stays out of users' projects.

The repository root is a Godot project (the demo), with `.gitattributes` keeping the demo and tools out of the Asset Library download.

## 3. Optional: itch.io

Make an itch.io page with the screenshots, a link to the repository and a zip of `addons/playtest_lens`. You can also upload an exported build of the Reef Runner demo so people can try it.

## Before every release

- Update `version` in `addons/playtest_lens/plugin.cfg`.
- Put your name in `LICENSE`, `addons/playtest_lens/LICENSE` and the `author` line of `plugin.cfg`.
- Open the project in Godot once, and check that the Output panel shows no errors.
- Regenerate the sample data if the format changed: `tools/record_sample_sessions.sh`.
