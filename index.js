const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const md5File = require('md5-file')
const _ = require('lodash');
const minify = require('html-minifier').minify;
const CleanCSS = require('clean-css');
const options = {
    level: 2
};
const cleanup = new CleanCSS(options);
const css = require('css');
const readfileOpts = {
    encoding: 'utf8'
};

const argv = require('yargs')
    .describe('pdf', 'input pdf file path')
    .nargs('pdf', 1)
    .describe('dest', 'destination folder')
    .nargs('dest', 1)
    .describe('prefix', 'images and css prefix')
    .nargs('prefix', 1)
    .alias('p', 'page')
    .describe('p', 'page from the manual to generate, if none, the manual will be generated entirely')
    .nargs('page', 1)
    .describe('fallback', 'activate fallback for full image html')
    .boolean('fallback')
    .default('fallback', false)
    .demandOption(['pdf', 'dest', 'prefix'])
    .describe('test', 'generate index.html to test')
    .boolean('test')
    .count('verbose')
    .alias('v', 'verbose')
    .help('h')
    .alias('h', 'help')
    .argv;

const pdf_file = argv.pdf.startsWith('/') ? argv.pdf : path.join(__dirname, argv.pdf);

// dest folder
const dest_folder = argv.dest.startsWith('/') ? argv.dest : path.join(__dirname, argv.dest);
if (!fs.existsSync(dest_folder)) {
    // TODO error
    console.error(`dest folder '${dest_folder} does not exists !`);
    process.exit(404);
}

// tmp build folder
const tmp_folder = path.join(dest_folder, '.tmp');
mkdirp.sync(tmp_folder);

// tmp page folder
const tmp_page_folder = path.join(tmp_folder, 'pages');
mkdirp.sync(tmp_page_folder);

const manual_filename = 'manual.html';
const manual_filepath = pdf_file;

const css_filename = 'manual.css';
const css_filepath = path.join(tmp_folder, css_filename);

const manual_folder = path.join(dest_folder, 'manual');
mkdirp.sync(manual_folder);

const thumbnail_folder = path.join(dest_folder, 'thumbnails');
mkdirp.sync(thumbnail_folder);

function convertPDF(cb) {
    log('##### convert PDF #####');
    const cmd = 'pdf2htmlEX'
    let options = [
        '--fallback', argv.fallback ? 1 : 0,
        '--bg-format', 'svg',
        '--debug', argv.verbose > 1 ? 1 : 0,
        '--optimize-text', 1,
        '--process-outline', 0,
        '--process-nontext', 1,
        '--space-as-offset', 1,
        '--embed-font', 0,
        '--embed-image', 0,
        '--embed-css', 0,
        '--printing', 0,
        '--space-threshold', 0.125, // default 0.125
        '--heps', 1, // default 1
        '--veps', 1, // default 1
        '--split-pages', 1,
        '--css-filename', css_filename,
        '--page-filename', 'pages/page-%d.html',
        `--dest-dir`, tmp_folder,
        manual_filepath,
        manual_filename
    ];
    if (argv.page) {
        options = ['-f', argv.page, '-l', argv.page].concat(options);
    }
    run(cmd, options, cb);
}

function generateThumbnail(cb) {
    log('##### generate Thumbnail #####');
    const cmd = 'convert';
    const options = [
        '-monitor',
        argv.page ? `${pdf_file}[${argv.page}]` : pdf_file,
        argv.page ? `${thumbnail_folder}/page-${argv.page}.png` : `${thumbnail_folder}/page.png`
    ];
    run(cmd, options, cb);
}

function run(cmd, options, next) {
    const spawn = require('child_process').spawn;
    const convert = spawn(cmd, options);
    if (argv.verbose > 0) {
        convert.stdout.on('data', data => process.stdout.write(data));
        convert.stderr.on('data', data => process.stderr.write(data));
    }
    convert.on('close', code => next(code === 0 ? undefined : code));
}

function optimizeHTML() {
    log('##### optimize HTML #####');
    const assets = processAssets();
    log('load css file');
    const cssfile = css.parse(fs.readFileSync(css_filepath, readfileOpts));
    const pages = loadPages(assets, cssfile);
    log('write html and css pages');
    const test_includes = [];
    const test_pages = [];
    pages.map((page) => {
        fs.writeFileSync(path.join(manual_folder, page.file), page.content, options);
        fs.writeFileSync(path.join(manual_folder, page.css_file), cleanup.minify(css.stringify(page.css, options)).styles, options);
        if (argv.test) {
            test_pages.push(`<div>${page.content}</div>`);
            test_includes.push(`<link href="${manual_folder}/${page.css_file}" rel="stylesheet" type="text/css">`);
        }
    });
    if (argv.test) {
        writeTest(test_includes, test_pages);
    }
    writeManifest(assets, pages);

}

function processAssets() {
    var processed = {
        svg: {},
        fonts: {}
    };
    fs.readdirSync(tmp_folder).forEach(asset => {
        if (asset.endsWith('.svg')) {
            log(`process asset ${asset}`);
            processed.svg[asset] = {
                filename: asset,
                filepath: path.join(manual_folder, asset)
            };
            fs.createReadStream(path.join(tmp_folder, asset))
                .pipe(fs.createWriteStream(path.join(manual_folder, asset)));
        } else if (asset.endsWith('.woff')) {
            log(`process asset ${asset}`);
            const filename = `${md5File.sync(path.join(tmp_folder, asset))}.woff`;
            processed.fonts[asset] = {
                filename: filename,
                filepath: path.join(manual_folder, filename)
            };
            fs.createReadStream(path.join(tmp_folder, asset))
                .pipe(fs.createWriteStream(path.join(manual_folder, filename)));
        }
    });
    return processed;
}

function loadPages(assets, cssfile) {
    log('load page files');
    const pages = [];
    fs.readdirSync(tmp_page_folder).forEach(file => {
        const page_number = getPageNumber(file);
        const content = minify(fs.readFileSync(path.join(tmp_page_folder, file), readfileOpts));
        const id = getId(content);
        const classes = getClasses(content);
        log(`process page ${id} content`);
        pages.push({
            page_number,
            file,
            id,
            content: minify(updateHtml(assets, content)),
            css_file: file.replace(/\.html$/i, '.css'),
            classes,
            css: buildPageCss(assets, cssfile, id, classes)
        });
    });
    return pages;
}

function getPageNumber(file) {
    return parseInt(file.replace(/^page-([0-9]+\.html$)/i, '$1'));
}

function getId(content) {
    let id = content.match(/data\-page\-no="([^"]+)"/g);
    id = id ? id[0].substring(14, id[0].length - 1) : '';
    return id;
}

function getClasses(content) {
    const classes = new Set();
    content.match(/class="([^"]+)"/g).map(elmt => {
        const elmts = elmt.substring(7, elmt.length - 1).split(' ');
        elmts.map(c => {
            if (c && c.length > 0) {
                classes.add(c);
            }
        });
    });
    return classes;
}

function updateHtml(assets, content) {
    content = content.replace(/"([a-zA-Z0-9]+\.svg)"/g, (match, svg) => {
        return `"${argv.prefix}/${assets.svg[svg].filename}"`;
    });
    return content;
}

function buildPageCss(assets, cssfile, id, classes) {
    const cssrules = {
        stylesheet: {
            rules: []
        }
    }
    for (let i = 0; i < cssfile.stylesheet.rules.length; ++i) {
        const rule = cssfile.stylesheet.rules[i];
        if (rule.type === 'rule' && rule.selectors.length === 1) {
            const selector = rule.selectors[0];
            const selectors = [];
            if (classes.has(selector.substring(1))) {
                if (selector === 'pf' || selector.match(/[wh][0-9]+/g)) {
                    selectors.push(`#pf${id}${selector}`);
                }
                selectors.push(`#pf${id} ${selector}`);
            }
            if (selectors.length > 0) {
                const page_rule = _.cloneDeep(rule);
                page_rule.selectors = selectors;
                cssrules.stylesheet.rules.push(page_rule);
            }
        } else if (rule.type === 'font-face') {
            const name = rule.declarations.filter(d => d.property === 'font-family')[0].value;
            if (classes.has(name)) {
                const page_rule = _.cloneDeep(rule);
                const src = page_rule.declarations.filter(d => d.property === 'src')[0];
                src.value = src.value.replace(/url\(([^)]+)\)/i, (match, font) => {
                    return `url(${argv.prefix}/${assets.fonts[font].filename})`;
                });
                cssrules.stylesheet.rules.push(page_rule);
            }
        }
    }
    return cssrules;
}

function log() {
    if (argv.verbose > 0) {
        console.log.apply(console.log, arguments);
    }
}

function writeTest(styles, pages) {
    log('##### write test file #####');
    const test = fs.createWriteStream(path.join(dest_folder, 'index.html'));
    test.write(`<html><head><meta charset="utf-8"/>`);
    test.write(`<link rel="stylesheet" href="${tmp_folder}/base.min.css"/>`);
    test.write(`<link rel="stylesheet" href="${tmp_folder}/fancy.min.css"/>`);
    styles.forEach(style => test.write(style));
    test.write('</head><body>');
    pages.forEach(page => test.write(page));
    test.end('</body></html>');
}

function writeManifest(assets, pages) {
    log('##### write manifest file #####');
    const manifestStream = fs.createWriteStream(path.join(dest_folder, 'manifest.json'));
    const manifest = {
        images: Object.keys(assets.svg).map(key => assets.svg[key].filepath),
        fonts: Object.keys(assets.fonts).map(key => assets.fonts[key].filepath),
        pages: pages.map(page => {
            return {
                html: path.join(manual_folder, page.file),
                css: path.join(manual_folder, page.css_file)
            }
        })
    };
    manifestStream.end(JSON.stringify(manifest, null, '  '));
}

let convertPDFDone = false;
let generateThumbnailDone = false;

generateThumbnail((err) => {
    if (err) {
        console.error(err);
        return process.exit(-1);
    }
    generateThumbnailDone = true;
    if (convertPDFDone) {
        optimizeHTML();
    }
});

convertPDF((err) => {
    if (err) {
        console.error(err);
        return process.exit(-1);
    }
    convertPDFDone = true;
    if (generateThumbnailDone) {
        optimizeHTML();
    }
});

// optimizeHTML();