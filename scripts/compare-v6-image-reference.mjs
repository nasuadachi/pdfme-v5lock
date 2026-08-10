import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const referenceRoot = path.join(repositoryRoot, 'image-references', '5f70376d');
const outputRoot = path.join(repositoryRoot, 'tmp', 'image-reference-diff', '5f70376d');
const reviewRoot = path.join(repositoryRoot, 'tmp', 'image-reference-review', '5f70376d');
const failOnDifference = process.argv.includes('--fail-on-difference');

const imageGroups = [
  {
    name: 'generator',
    current: path.join(repositoryRoot, 'packages/generator/__tests__/__image_snapshots__'),
    reference: path.join(referenceRoot, 'packages/generator/__tests__/__image_snapshots__'),
  },
  {
    name: 'manipulator',
    current: path.join(repositoryRoot, 'packages/manipulator/__tests__/e2e/__image_snapshots__'),
    // v6 moved these snapshots out of the e2e directory.
    reference: path.join(referenceRoot, 'packages/manipulator/__tests__/__image_snapshots__'),
  },
];

const listPngFiles = (directory) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => entry.name)
    .sort();

const formatPercent = (value) => `${value.toFixed(5)}%`;
const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const writeReviewImage = async ({ currentPath, referencePath, diffPath, reviewPath, label }) => {
  const images = await Promise.all([currentPath, referencePath, diffPath].map(loadImage));
  const panelWidth = Math.max(...images.map((image) => image.width));
  const panelHeight = Math.max(...images.map((image) => image.height));
  const headerHeight = 62;
  const gutter = 10;
  const canvas = createCanvas(panelWidth * 3 + gutter * 2, panelHeight + headerHeight);
  const context = canvas.getContext('2d');
  const labels = ['現在のv5.5基準画像', 'v6参照画像 (5f70376d)', label];

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.font = '20px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  images.forEach((image, index) => {
    const panelX = index * (panelWidth + gutter);
    context.fillText(labels[index], panelX + panelWidth / 2, headerHeight / 2);
    context.drawImage(
      image,
      panelX + (panelWidth - image.width) / 2,
      headerHeight + (panelHeight - image.height) / 2,
    );
  });

  context.fillStyle = '#d0d0d0';
  context.fillRect(panelWidth, 0, gutter, canvas.height);
  context.fillRect(panelWidth * 2 + gutter, 0, gutter, canvas.height);
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, canvas.toBuffer('image/png'));
};

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.rmSync(reviewRoot, { recursive: true, force: true });

const results = [];

for (const group of imageGroups) {
  for (const filename of listPngFiles(group.reference)) {
    const currentPath = path.join(group.current, filename);
    const referencePath = path.join(group.reference, filename);

    if (!fs.existsSync(currentPath)) {
      throw new Error(`Reference has no corresponding v5.5 image: ${group.name}/${filename}`);
    }

    const current = PNG.sync.read(fs.readFileSync(currentPath));
    const reference = PNG.sync.read(fs.readFileSync(referencePath));
    const dimensionsMatch =
      current.width === reference.width && current.height === reference.height;

    if (!dimensionsMatch) {
      results.push({
        group: group.name,
        filename,
        dimensionsMatch: false,
        currentSize: `${current.width}x${current.height}`,
        referenceSize: `${reference.width}x${reference.height}`,
      });
      continue;
    }

    const totalPixels = current.width * current.height;
    let differentPixels = 0;
    let totalChannelDifference = 0;
    let maximumChannelDifference = 0;

    for (let offset = 0; offset < current.data.length; offset += 4) {
      let pixelIsDifferent = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const difference = Math.abs(
          current.data[offset + channel] - reference.data[offset + channel],
        );
        pixelIsDifferent ||= difference !== 0;
        totalChannelDifference += difference;
        maximumChannelDifference = Math.max(maximumChannelDifference, difference);
      }
      differentPixels += Number(pixelIsDifferent);
    }

    if (differentPixels > 0) {
      const diff = new PNG({ width: current.width, height: current.height });
      pixelmatch(current.data, reference.data, diff.data, current.width, current.height, {
        threshold: 0,
        includeAA: true,
        diffColor: [255, 0, 0],
        aaColor: [255, 255, 0],
      });
      const diffPath = path.join(outputRoot, group.name, filename);
      fs.mkdirSync(path.dirname(diffPath), { recursive: true });
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
      const reviewRelativePath = path.join(group.name, filename);
      await writeReviewImage({
        currentPath,
        referencePath,
        diffPath,
        reviewPath: path.join(reviewRoot, reviewRelativePath),
        label: `差分: ${formatPercent((differentPixels / totalPixels) * 100)} / ${differentPixels.toLocaleString()} px`,
      });
    }

    results.push({
      group: group.name,
      filename,
      dimensionsMatch: true,
      differentPixels,
      differentPixelPercent: (differentPixels / totalPixels) * 100,
      meanChannelDifference: totalChannelDifference / (totalPixels * 4),
      maximumChannelDifference,
    });
  }
}

const differences = results.filter(
  (result) => !result.dimensionsMatch || result.differentPixels > 0,
);
const exactMatches = results.length - differences.length;
const rankedDifferences = differences
  .filter((result) => result.dimensionsMatch)
  .sort((left, right) => right.differentPixelPercent - left.differentPixelPercent);

const reviewRows = rankedDifferences
  .map(
    (result, index) => `<article>
      <h2>${index + 1}. ${escapeHtml(result.group)}/${escapeHtml(result.filename)}</h2>
      <p>${formatPercent(result.differentPixelPercent)} · ${result.differentPixels.toLocaleString()} px</p>
      <a href="${result.group}/${encodeURIComponent(result.filename)}"><img loading="lazy" src="${result.group}/${encodeURIComponent(result.filename)}" alt="${escapeHtml(result.filename)}の比較画像"></a>
    </article>`,
  )
  .join('\n');

const reviewHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>v5.5 と v6 参照画像の差分</title>
  <style>
    body { margin: 24px; color: #222; background: #f4f4f4; font-family: sans-serif; }
    h1 { font-size: 24px; }
    .summary { margin-bottom: 24px; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
    article { min-width: 0; padding: 12px; background: #fff; border: 1px solid #ccc; border-radius: 8px; }
    h2 { margin: 0; overflow-wrap: anywhere; font-size: 16px; }
    p { margin: 4px 0 10px; color: #555; }
    img { display: block; width: 100%; height: auto; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>v5.5 と v6 参照画像の差分</h1>
  <p class="summary">比較対象${results.length}枚中、差分のある${rankedDifferences.length}枚。左が現在のv5.5、中央が5f70376d、右が差分です。赤い部分はRGBA値が異なるピクセルです。</p>
  <main>${reviewRows}</main>
</body>
</html>
`;

fs.mkdirSync(reviewRoot, { recursive: true });
fs.writeFileSync(path.join(reviewRoot, 'index.html'), reviewHtml);
fs.writeFileSync(
  path.join(reviewRoot, 'README.txt'),
  `v5.5 と v6参照画像 (5f70376d) の目視確認用\n\nindex.html をブラウザで開いてください。\n左: 現在のv5.5基準画像\n中央: v6参照画像\n右: RGBA値の差分（赤色）\n\n比較対象: ${results.length}枚\n差分あり: ${rankedDifferences.length}枚\n`,
);

const summary = {
  referenceCommit: '5f70376d12092adc74cb44ddbb61f979b963c290',
  comparedImages: results.length,
  exactMatches,
  differences: differences.length,
  dimensionDifferences: differences.filter((result) => !result.dimensionsMatch).length,
  results,
};

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log(`Compared: ${results.length}`);
console.log(`Exact pixel matches: ${exactMatches}`);
console.log(`Images with differences: ${differences.length}`);
console.log(`Diff output: ${path.relative(repositoryRoot, outputRoot)}`);
console.log(`Visual review: ${path.relative(repositoryRoot, reviewRoot)}`);

if (rankedDifferences.length > 0) {
  console.log('\nLargest differences:');
  for (const result of rankedDifferences.slice(0, 20)) {
    console.log(
      `${formatPercent(result.differentPixelPercent).padStart(10)}  ${String(result.differentPixels).padStart(8)} px  ${result.group}/${result.filename}`,
    );
  }
}

if (failOnDifference && differences.length > 0) {
  process.exitCode = 1;
}
