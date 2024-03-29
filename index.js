const fs = require('fs');
const path = require('path');
const Rx = require('rxjs/Rx');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const md5File = require('md5-file')
const _ = require('lodash');
const minify = require('html-minifier').minify;
const CleanCSS = require('clean-css');
const cssOpts = {
    level: 2
};
const cleanup = new CleanCSS(cssOpts);
const css = require('css');
const readfileOpts = {
    encoding: 'utf8'
};
const writeFileOpts = {
    encoding: 'utf8'
}

class InternalError extends Error {

    constructor(code, msg) {
        super(msg);
        this.code = code;
    }

}

const argv = require('yargs')
    .describe('input', 'input json configuration file')
    .nargs('input', 1)
    .demand('input')
    .describe('test', 'generate index.html to test')
    .boolean('test')
    .describe('folder', 'create folder destination folders')
    .boolean('folder')
    .describe('verbose', 'activate log')
    .alias('v', 'verbose')
    .count('verbose')
    .help('h')
    .alias('h', 'help')
    .argv;

const image_format = 'png';
const start = new Date();

let config;
try {
    config = require(argv.input);
} catch (err) {
    console.error(err);
    process.exit(404);
}

// validate dest folder
if (!fs.existsSync(config.textbook_folder_path)) {
    if (argv.folder) {
        mkdirp.sync(config.textbook_folder_path);
    } else {
        console.error(`dest folder '${config.textbook_folder_path} does not exists !`);
        process.exit(404);
    }
}

// init manifest
const manifest = _.cloneDeep(config);
manifest.start_at = start;
manifest.version = require(path.join(__dirname, 'package.json')).version;
manifest.pages.forEach(page => page.processed = false);
manifest.warnings = [];
manifest.tmp_folder_path = path.join(manifest.textbook_folder_path, '.tmp');
try {
    const version = require('child_process').spawnSync('pdf2htmlEX', ['--version']);
    if (version.status !== 0) {
        return error({
            code: version.status,
            msg: {
                error: version.error,
                stderr: version.stderr
            }
        });
    }
    manifest.pdf2htmlex_version = version.stderr.toString();
} catch (err) {
    return error(new InternalError(-1, `checking pdf2htmlEX version error: ${err}`));
}

// init tmp folders
const tmp_folder = manifest.tmp_folder_path;
const tmp_page_folder = path.join(tmp_folder, 'pages');
const css_filename = 'manual.css';
const css_filepath = path.join(tmp_folder, css_filename);
try {
    if (fs.existsSync(tmp_folder)) rimraf.sync(tmp_folder);
    mkdirp.sync(tmp_folder);
    mkdirp.sync(tmp_page_folder);
} catch (err) {
    return error(new InternalError(-1, `creating tmp folder '${manifest.tmp_folder_path} error: ${err}`));
}

// validate input pdf file
if (!fs.existsSync(manifest.pdf_file_path)) {
    return error(new InternalError(404, `input pdf file '${manifest.pdf_file_path} does not exists !`));
}

// validate dest pages folder
if (!fs.existsSync(manifest.textbook_pages_folder_path)) {
    if (argv.folder) {
        mkdirp.sync(config.textbook_pages_folder_path);
    } else {
        return error(new InternalError(404, `dest pages folder '${manifest.textbook_pages_folder_path} does not exists !`));
    }
}

// validate dest fonts folder
if (!fs.existsSync(manifest.textbook_fonts_folder_path)) {
    if (argv.folder) {
        mkdirp.sync(config.textbook_fonts_folder_path);
    } else {
        return error(new InternalError(404, `dest fonts folder '${manifest.textbook_fonts_folder_path} does not exists !`));
    }
}

// Run pdf2htmlEX
function convertPDF(cb) {
    const spawn = require('child_process').spawn;
    const cmd = 'pdf2htmlEX'
    let options = [
        '--fallback', manifest.use_fallback === true ? 1 : 0,
        '--bg-format', image_format,
        '--debug', argv.verbose > 1 ? 1 : 0,
        '--optimize-text', 0, // default 0
        '--process-outline', 1, // default 1
        '--process-nontext', 1, // default 1
        '--space-as-offset', 0, // default 0
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
        manifest.pdf_file_path
    ];
    if (manifest.page_number !== undefined && manifest.page_number !== null) {
        options = ['-f', manifest.page_number, '-l', manifest.page_number].concat(options);
    }
    if (manifest.data_dir !== undefined && manifest.data_dir !== null) {
        options = ['--data-dir', manifest.data_dir].concat(options);
    }
    log('pdf2htmlEx options:', options);
    const convert = spawn(cmd, options);
    if (argv.verbose > 0) {
        convert.stdout.on('data', data => process.stdout.write(data));
        convert.stderr.on('data', data => process.stderr.write(data));
    }
    convert.on('close', code => cb(code === 0 ? undefined : code));
}

function processFonts() {
    return Rx.Observable.create(function (observer) {
        const fonts = {};
        const duplicates = [];
        manifest.font_file_paths = [];
        fs.readdir(tmp_folder, (err, files) => {
            if (err) return observer.error(err);
            let promise = Promise.resolve();
            files.forEach(file => {
                if (!file.endsWith('.woff')) return;
                log(`process font ${file}`);
                const font = buildFont(file);
                fonts[file] = font;
                if (fs.existsSync(font.file_path)) duplicates.push(font.file_name);
                manifest.font_file_paths.push(font.file_path);
                promise = promise.then(() => copyFile(path.join(tmp_folder, file), font.file_path));
            });
            observer.next(fonts);
            promise = promise.then(() => addDup2Manifest(duplicates, fonts));
            promise.then(() => observer.complete(), err => observer.error(err));
        });
    });
}

function buildFont(font) {
    const font_md5 = md5File.sync(path.join(tmp_folder, font));
    const font_family = `ff_${manifest.textbook_id}_${font_md5}`;
    const file_name = `${font_md5}.woff`;
    const file_path = path.join(manifest.textbook_fonts_folder_path, file_name);
    return {
        font_md5,
        font_family,
        file_name,
        file_path,
        url: `${manifest.storage_prefix}/fonts/${file_name}`
    };
}

function addDup2Manifest(duplicates, fonts) {
    return new Promise((resolve) => {
        duplicates.forEach(d => {
            const occ = [];
            for (var prop in fonts) {
                if (Object.prototype.hasOwnProperty.call(fonts, prop)) {
                    if (fonts[prop].file_name === d) {
                        occ.push(prop); // TODO check diff
                    }
                }
            }
            manifest.warnings.push({
                error: 'duplicate font',
                d,
                fonts: occ
            });
        });
        resolve();
    });
}

function processHtml(fonts) {
    return readFile(css_filepath).then(data => {
        let cssfile;
        try {
            cssfile = css.parse(data);
        } catch (err) {
            return Promise.reject(err);
        }
        return processPages(fonts, cssfile).then(pages => {
            if (argv.test) writeTest(pages);
        });
    });
}

function processPages(fonts, cssfile) {
    return readDir(tmp_page_folder).then(files => {
        if (files.length !== manifest.pages.length) {
            manifest.warnings.push({
                error: 'mismatch number of pages',
                msg: files.length > manifest.pages.length ?
                    'more pages are generated than declared' : 'more pages are declared than generated',
                nb_declared_pages: manifest.pages.length,
                nb_generated_pages: files.length
            });
        }
        const pages = [];
        let promise = Promise.resolve();
        files.forEach(file => {
            promise = promise.then(() => {
                return processPage(fonts, cssfile, file)
                    .then(page => {
                        pages.push(page);
                        return Promise.resolve();
                    });
            });
        });
        return promise.then(() => pages);
    });
}

function processPage(fonts, cssfile, page_file) {
    return readFile(path.join(tmp_page_folder, page_file)).then(data => {
        const page_number = getPageNumber(page_file);
        const config_page = getPageConfig(page_number);
        if (config_page instanceof InternalError) return Promise.reject(config_page);
        data = processPageImages(config_page, minify(data));
        const pfdata = processPageHtml(config_page, data);
        if (!pfdata) return Promise.reject(new InternalError('error parsing: page id not found !'));
        log(`process page ${pfdata.pfid} - ${pfdata.id} content`);
        const html_file_path = path.join(config_page.page_folder_path, `${config_page.id}.html`);
        const classes = getClasses(data.html);
        const css_file_path = path.join(config_page.page_folder_path, `${config_page.id}.css`);
        const styles = cleanup.minify(css.stringify(buildPageCss(fonts, cssfile, pfdata, classes), cssOpts)).styles;
        try {
            return Promise.all(data.promises.concat([
                writeFile(html_file_path, data.html),
                writeFile(css_file_path, styles)
            ])).then(() => {
                config_page.processed = true;
                config_page.html_file_path = html_file_path;
                config_page.css_file_path = css_file_path;
                return {
                    page_number,
                    html: data.html,
                    css_file_path
                };
            });
        } catch (err) {
            return Promise.reject(err);
        }
    });
}

function getPageConfig(page_number) {
    const config_page = manifest.pages.find(page => page.number === page_number);
    if (!config_page) {
        return new InternalError(404, `no config found for page ${page_number}`);
    }
    if (!fs.existsSync(config_page.page_folder_path)) {
        if (argv.folder) {
            mkdirp.sync(config_page.page_folder_path);
        } else {
            return new InternalError(404, `page folder '${config_page.page_folder_path} does not exists !`);
        }
    }
    if (!fs.existsSync(config_page.page_image_folder_path)) {
        if (argv.folder) {
            mkdirp.sync(config_page.page_image_folder_path);
        } else {
            return new InternalError(404, `page image folder '${config_page.page_image_folder_path} does not exists !`);
        }
    }
    return config_page;
}

function getPageNumber(file) {
    return parseInt(file.replace(/^page-([0-9]+\.html$)/i, '$1'));
}

const ID_REGEXP = new RegExp('<div id="[^"]+" class="([^"]+)" data\-page\-no="([^"]+)">');
const LINK_REGEXP = new RegExp('<a ([^>]*)>', 'g');

function processPageHtml(config_page, data) {
    let pfdata;
    data.html = data.html.replace(ID_REGEXP, (match, pfclass, pfid) => {
        pfdata = {
            class: pfclass,
            id: `pf-${config_page.id}`,
            pfid
        }
        return `<div id="${pfdata.id}" class="${pfdata.class}" data-page-no="${pfdata.pfid}">`;
    });
    data.html = data.html.replace(LINK_REGEXP, (match, attr) => `<a target="_blank" ${attr}>`);
    return pfdata;
}

function getClasses(content) {
    const classes = new Set();
    content.match(/class="([^"]+)"/g).map(elmt => {
        elmt.substring(7, elmt.length - 1).split(' ').map(c => {
            if (c && c.length > 0) classes.add(c);
        });
    });
    return classes;
}

const REGEXP_IMG = new RegExp(`"([a-zA-Z0-9]+\.${image_format})"`, 'g');

function processPageImages(config_page, html) {
    let index = 0;
    config_page.image_file_paths = [];
    const promises = [];
    html = html.replace(REGEXP_IMG, (match, img) => {
        const file_name = `${config_page.id}-${++index}.${image_format}`;
        const file_path = path.join(config_page.page_image_folder_path, file_name);
        config_page.image_file_paths.push(file_path);
        promises.push(copyFile(path.join(tmp_folder, img), file_path));
        const url = `${manifest.storage_prefix}/pages/${config_page.id}/images/${file_name}`;
        return `"${url}"`;
    });
    return {
        html,
        promises
    };
}

function buildPageCss(fonts, cssfile, pfdata, classes) {
    const cssrules = {
        stylesheet: {
            rules: []
        }
    }
    for (let i = 0; i < cssfile.stylesheet.rules.length; ++i) {
        const rule = cssfile.stylesheet.rules[i];
        if (rule.type === 'rule' && rule.selectors.length === 1) {
            buildPageCssRule(pfdata, fonts, classes, cssrules, rule);
        } else if (rule.type === 'font-face') {
            buildPageCssFontFace(fonts, classes, cssrules, rule);
        }
    }
    return cssrules;
}

function buildPageCssRule(pfdata, fonts, classes, cssrules, rule) {
    const selector = rule.selectors[0];
    const selectors = [];
    if (classes.has(selector.substring(1))) {
        if (pfdata.class.includes(selector.substring(1))) {
            selectors.push(`#${pfdata.id}${selector}`);
        }
        selectors.push(`#${pfdata.id} ${selector}`);
        const font_family = rule.declarations.filter(d => d.property === 'font-family')[0];
        if (font_family) {
            const font = fonts[`${font_family.value.substring(1)}.woff`];
            if (font) {
                font_family.value = font.font_family;
            }
        }
    }
    if (selectors.length > 0) {
        const page_rule = _.cloneDeep(rule);
        page_rule.selectors = selectors;
        cssrules.stylesheet.rules.push(page_rule);
    }
}

function buildPageCssFontFace(fonts, classes, cssrules, rule) {
    let name = rule.declarations.filter(d => d.property === 'font-family')[0];
    if (classes.has(name.value)) {
        const page_rule = _.cloneDeep(rule);
        name = page_rule.declarations.filter(d => d.property === 'font-family')[0];
        const font = fonts[`${name.value.substring(1)}.woff`];
        name.value = font.font_family;
        const src = page_rule.declarations.filter(d => d.property === 'src')[0];
        src.value = src.value.replace(/url\(([^)]+)\)/i, (match, font) => {
            return `url(${fonts[font].url})`;
        });
        cssrules.stylesheet.rules.push(page_rule);
    }
}

function log() {
    if (argv.verbose > 0) {
        console.log.apply(console.log, arguments);
    }
}

function writeTest(pages) {
    const test_includes = [];
    const test_pages = [];
    pages.sort((a, b) => a.page_number - b.page_number);
    for (let i = 0; i < pages.length; ++i) {
        const page = pages[i];
        test_pages.push(`<div>${page.html}</div>`);
        test_includes.push(`<link href="${page.css_file_path}" rel="stylesheet" type="text/css">`);
    }
    const test = fs.createWriteStream(path.join(tmp_folder, 'index.html'));
    test.write(`<html><head><meta charset="utf-8"/>`);
    test.write(`<link rel="stylesheet" href="${tmp_folder}/base.min.css"/>`);
    test.write(`<link rel="stylesheet" href="${tmp_folder}/fancy.min.css"/>`);
    test_includes.forEach(style => test.write(style));
    test.write('</head><body>');
    test_pages.forEach(page => test.write(page));
    test.end('</body></html>');
}

function writeManifest(cb) {
    log('write manifest')
    manifest.created_at = new Date();
    manifest.process_time = `${manifest.created_at.getTime() - manifest.start_at.getTime()} ms`;
    const manifestStream = fs.createWriteStream(manifest.manifest_file_path);
    cb = cb || ((err) => {
        if (err) console.error(err);
    });
    manifestStream.on('finish', cb);
    manifestStream.on('error', cb);
    manifestStream.end(JSON.stringify(manifest, null, '  '));
}

function readDir(dir_path) {
    return new Promise((resolve, reject) => {
        try {
            fs.readdir(dir_path, (err, files) => {
                if (err) return reject(err);
                resolve(files);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function readFile(file_path) {
    return new Promise((resolve, reject) => {
        try {
            fs.readFile(file_path, readfileOpts, (err, data) => {
                if (err) return reject(err);
                resolve(data);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function writeFile(file_path, data) {
    return new Promise((resolve, reject) => {
        try {
            fs.writeFile(file_path, data, writeFileOpts, (err) => {
                if (err) return reject(err);
                resolve();
            });
        } catch (err) {
            reject(err);
        }
    });
}

function copyFile(file_path_src, file_path_dest) {
    return new Promise((resolve, reject) => {
        try {
            const rstream = fs.createReadStream(file_path_src);
            const wstream = fs.createWriteStream(file_path_dest);
            wstream.on('error', reject);
            wstream.on('finish', () => {
                rstream.destroy();
                wstream.end();
                resolve();
            });
            rstream.pipe(wstream);
        } catch (err) {
            reject(err);
        }
    })
}

function error(err) {
    let code, msg;
    if (err instanceof InternalError) {
        code = err.code, msg = err.message;
    } else if (err) {
        code = -1, msg = err.message;
    }
    console.error(err);
    manifest.exit_code = code || -1;
    manifest.error_message = msg;
    writeManifest(() => process.exit(code));
}

let fontsDone = false;
let htmlDone = false;

function done() {
    if (fontsDone && htmlDone) writeManifest();
}

convertPDF((err) => {
    if (err) return error(err);
processFonts().subscribe(
    fonts => {
        processHtml(fonts).then(
            () => {
                log('all html are processed');
                htmlDone = true;
                done();
            }, err => error(err));
    },
    err => error(err),
    () => {
        log('all fonts are processed');
        fontsDone = true;
        done();
    });
});
