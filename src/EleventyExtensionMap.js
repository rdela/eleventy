import { TemplatePath } from "@11ty/eleventy-utils";

import TemplateEngineManager from "./Engines/TemplateEngineManager.js";
import EleventyBaseError from "./Errors/EleventyBaseError.js";

class EleventyExtensionMapConfigError extends EleventyBaseError {}

class EleventyExtensionMap {
	constructor(config) {
		this.config = config;

		this._spiderJsDepsCache = {};
	}

	setFormats(formatKeys = []) {
		// raw
		this.formatKeys = formatKeys;

		this.unfilteredFormatKeys = formatKeys.map(function (key) {
			return key.trim().toLowerCase();
		});

		this.validTemplateLanguageKeys = this.unfilteredFormatKeys.filter((key) =>
			this.hasExtension(key),
		);

		this.passthroughCopyKeys = this.unfilteredFormatKeys.filter((key) => !this.hasExtension(key));
	}

	set config(cfg) {
		if (!cfg || cfg.constructor.name !== "TemplateConfig") {
			throw new EleventyExtensionMapConfigError(
				"Missing or invalid `config` argument (via setter).",
			);
		}
		this.eleventyConfig = cfg;
	}

	get config() {
		return this.eleventyConfig.getConfig();
	}

	get engineManager() {
		if (!this._engineManager) {
			this._engineManager = new TemplateEngineManager(this.eleventyConfig);
		}

		return this._engineManager;
	}

	reset() {
		this.engineManager.reset();
	}

	/* Used for layout path resolution */
	getFileList(path, dir) {
		if (!path) {
			return [];
		}

		let files = [];
		this.validTemplateLanguageKeys.forEach(
			function (key) {
				this.getExtensionsFromKey(key).forEach(function (extension) {
					files.push((dir ? dir + "/" : "") + path + "." + extension);
				});
			}.bind(this),
		);

		return files;
	}

	// Warning: this would false positive on an include, but is only used
	// on paths found from the file system glob search.
	// TODO: Method name might just need to be renamed to something more accurate.
	isFullTemplateFilePath(path) {
		for (let extension of this.validTemplateLanguageKeys) {
			if (path.endsWith(`.${extension}`)) {
				return true;
			}
		}
		return false;
	}

	getCustomExtensionEntry(extension) {
		if (!this.config.extensionMap) {
			return;
		}

		for (let entry of this.config.extensionMap) {
			if (entry.extension === extension) {
				return entry;
			}
		}
	}

	getValidExtensionsForPath(path) {
		let extensions = new Set();
		for (let extension in this.extensionToKeyMap) {
			if (path.endsWith(`.${extension}`)) {
				extensions.add(extension);
			}
		}

		// if multiple extensions are valid, sort from longest to shortest
		// e.g. .11ty.js and .js
		let sorted = Array.from(extensions)
			.filter((extension) => this.validTemplateLanguageKeys.includes(extension))
			.sort((a, b) => b.length - a.length);

		return sorted;
	}

	async shouldSpiderJavaScriptDependencies(path) {
		let extensions = this.getValidExtensionsForPath(path);
		for (let extension of extensions) {
			if (extension in this._spiderJsDepsCache) {
				return this._spiderJsDepsCache[extension];
			}

			let cls = await this.engineManager.getEngineClassByExtension(extension);
			if (cls) {
				let entry = this.getCustomExtensionEntry(extension);
				let shouldSpider = cls.shouldSpiderJavaScriptDependencies(entry);
				this._spiderJsDepsCache[extension] = shouldSpider;
				return shouldSpider;
			}
		}

		return false;
	}

	getPassthroughCopyGlobs(inputDir) {
		return this._getGlobs(this.passthroughCopyKeys, inputDir);
	}

	getValidGlobs(inputDir) {
		return this._getGlobs(this.validTemplateLanguageKeys, inputDir);
	}

	getGlobs(inputDir) {
		return this._getGlobs(this.unfilteredFormatKeys, inputDir);
	}

	_getGlobs(formatKeys, inputDir) {
		let dir = TemplatePath.convertToRecursiveGlobSync(inputDir);
		let extensions = [];
		for (let key of formatKeys) {
			if (this.hasExtension(key)) {
				for (let extension of this.getExtensionsFromKey(key)) {
					extensions.push(extension);
				}
			} else {
				extensions.push(key);
			}
		}

		let globs = [];
		if (extensions.length === 1) {
			globs.push(`${dir}/*.${extensions[0]}`);
		} else if (extensions.length > 1) {
			globs.push(`${dir}/*.{${extensions.join(",")}}`);
		}

		return globs;
	}

	hasExtension(key) {
		for (var extension in this.extensionToKeyMap) {
			if (this.extensionToKeyMap[extension] === key) {
				return true;
			}
		}
		return false;
	}

	getExtensionsFromKey(key) {
		let extensions = [];
		for (var extension in this.extensionToKeyMap) {
			if (this.extensionToKeyMap[extension] === key) {
				extensions.push(extension);
			}
		}
		return extensions;
	}

	// Only `addExtension` configuration API extensions
	getExtensionEntriesFromKey(key) {
		let entries = [];
		if ("extensionMap" in this.config) {
			for (let entry of this.config.extensionMap) {
				if (entry.key === key) {
					entries.push(entry);
				}
			}
		}
		return entries;
	}

	hasEngine(pathOrKey) {
		return !!this.getKey(pathOrKey);
	}

	getKey(pathOrKey) {
		pathOrKey = (pathOrKey || "").toLowerCase();

		for (var extension in this.extensionToKeyMap) {
			let key = this.extensionToKeyMap[extension];
			if (pathOrKey === extension) {
				return key;
			} else if (pathOrKey.endsWith("." + extension)) {
				return key;
			}
		}
	}

	removeTemplateExtension(path) {
		for (var extension in this.extensionToKeyMap) {
			if (path === extension || path.endsWith("." + extension)) {
				return path.slice(
					0,
					path.length - 1 - extension.length < 0 ? 0 : path.length - 1 - extension.length,
				);
			}
		}
		return path;
	}

	// keys are file extensions
	// values are template language keys
	get extensionToKeyMap() {
		if (!this._extensionToKeyMap) {
			this._extensionToKeyMap = {
				md: "md",
				html: "html",
				njk: "njk",
				liquid: "liquid",
				"11ty.js": "11ty.js",
				"11ty.cjs": "11ty.js",
				"11ty.mjs": "11ty.js",
			};

			if ("extensionMap" in this.config) {
				for (let entry of this.config.extensionMap) {
					this._extensionToKeyMap[entry.extension] = entry.key;
				}
			}
		}

		return this._extensionToKeyMap;
	}

	getAllTemplateKeys() {
		return Object.keys(this.extensionToKeyMap);
	}

	getReadableFileExtensions() {
		return Object.keys(this.extensionToKeyMap).join(" ");
	}
}

export default EleventyExtensionMap;
