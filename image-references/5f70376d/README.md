# v6 Node renderer image reference

These images come from commit `5f70376d12092adc74cb44ddbb61f979b963c290`
(`Fix Node pdf renderer and refresh snapshots`, 2026-03-20 18:13:04 +09:00).

Only images that have a corresponding active v5.5 snapshot are included:

- Generator: 56 images
- Manipulator: 97 images

The 42 Manipulator images introduced in v6 are intentionally excluded. Generator has no
v6-only images at this commit. In v6, Manipulator snapshots moved from the `e2e` directory
to `packages/manipulator/__tests__/__image_snapshots__`; the comparison script accounts for
that path change.

Run the exact RGBA pixel comparison with:

```sh
npm run compare:images:v6-reference
```

Raw diff images and a JSON summary are written to
`tmp/image-reference-diff/5f70376d`. Side-by-side review images and an `index.html` are
written to `tmp/image-reference-review/5f70376d`. Add `-- --fail-on-difference` when
differences should produce a non-zero exit code.
