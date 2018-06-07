/* global AWS, filesize */

import {$} from "./utils.js";
import BagEntry from "./BagEntry.js";
import Dashboard from "./Dashboard.js";
import SelectFiles from "./SelectFiles.js";
import ServerInfo from "./ServerInfo.js";
import WorkerPool from "./worker-pool.js";

export default class Bagger {
    constructor(elem) {
        this.container = elem;

        // This tracks the size + hash information we'll need to generate the
        // manifests after a successful upload:
        this.bagEntries = new Map();

        this.dashboard = new Dashboard($(".dashboard", elem));

        this.serverInfo = new ServerInfo($(".server-info", elem), status => {
            $(".bag", elem).classList.toggle("hidden", status != "successful");
        });

        this.fileSelector = new SelectFiles($(".dropzone", elem), files => {
            return this.addSelectedFiles(files);
        });

        this.hashPool = new WorkerPool(
            "js/hash-worker.js",
            4,
            // Hash result callback:
            evt => {
                this.dispatch({
                    type: "hash/progress",
                    path: evt.fullPath,
                    bytes: evt.bytesHashed,
                    elapsedMilliseconds: evt.elapsedMilliseconds
                });
            },
            // Worker Pool stats callback:
            () => {
                this.updateDashboardVisibility();
            }
        );

        $('.bag-finalize button[type="submit"]', elem).addEventListener(
            "click",
            evt => {
                evt.stopPropagation();
                evt.preventDefault();
                this.finalizeBag();
                return false;
            }
        );

        this.bagContents = $(".bag-contents", elem);
        this.bagEntryTemplate = $("template", this.bagContents);
    }

    dispatch(evt) {
        let m = evt.type.match(/^(hash|upload)\/(progress|complete)$/);
        if (m) {
            let entry = this.bagEntries.get(evt.path);
            // TODO: refactor the payload vs. tag file upload paths so we don't need to check here:
            if (entry) {
                let metric = entry.statistics[m[1]];
                metric.bytes = evt.bytes;
                metric.seconds = evt.elapsedMilliseconds / 1000;
            }
        }

        // We'll use rAF to throttle updates as preferred by the browser:
        window.requestAnimationFrame(() => {
            this.updateDisplay();
        });
    }

    updateDisplay() {
        let allowFinalization =
            this.bagEntries.size > 0 &&
            this.getActiveHashCount() == 0 &&
            this.getActiveUploadCount() == 0;

        $(".bag-finalize", this.element).classList.toggle(
            "hidden",
            !allowFinalization
        );

        this.updateDashboard();
    }

    updateDashboardVisibility() {
        let activeHashes = this.getActiveHashCount();
        let activeUploads = this.getActiveUploadCount();

        this.dashboard.container.classList.toggle(
            "hidden",
            activeHashes == 0 && activeUploads == 0
        );
    }

    getActiveUploadCount() {
        let incompleteUploads = 0;

        for (let entry of this.bagEntries.values()) {
            if (entry.size > entry.statistics.upload.bytes) {
                incompleteUploads += 1;
            }
        }

        return incompleteUploads;
    }

    getActiveHashCount() {
        return this.hashPool.activeWorkers.size;
    }

    updateDashboard() {
        this.updateDashboardVisibility();

        let totalFiles = 0,
            totalBytes = 0;
        let hashedFiles = 0,
            hashedBytes = 0,
            hashSeconds = 0.0;
        let uploadedFiles = 0,
            uploadedBytes = 0,
            uploadSeconds = 0.0;

        for (let entry of this.bagEntries.values()) {
            totalFiles++;
            totalBytes += entry.size;

            hashSeconds += entry.statistics.hash.seconds;
            hashedBytes += entry.statistics.hash.bytes;

            if (entry.statistics.hash.bytes == entry.size) {
                hashedFiles++;
            }

            uploadSeconds += entry.statistics.upload.seconds;
            uploadedBytes += entry.statistics.upload.bytes;

            if (entry.statistics.upload.bytes == entry.size) {
                uploadedFiles++;
            }
        }

        this.dashboard.updateDisplay({
            totalFiles,
            totalBytes,
            hashedFiles,
            hashedBytes,
            hashSeconds,
            uploadedFiles,
            uploadedBytes,
            uploadSeconds
        });
    }

    getBagName() {
        let bagName = this.container.querySelector("input[id=bag-name]").value;
        bagName = bagName.trim();

        bagName = bagName.replace(/[/+;]+/g, "_");

        if (!bagName) {
            throw `Invalid bag name: ${bagName}`;
        }

        return bagName;
    }

    displayBagEntry(fullPath) {
        let entryTemplate = document.importNode(
            this.bagEntryTemplate.content,
            true
        );

        let elem = entryTemplate.querySelector("tr");
        elem.id = fullPath;

        $("tbody", this.bagContents).appendChild(entryTemplate);

        return elem;
    }

    updateBagEntryDisplay(bagEntry) {
        let elem = bagEntry.element;

        $(".file-name", elem).textContent = bagEntry.path;
        $(".file-size", elem).textContent = filesize(bagEntry.size, {round: 1});

        for (let [name, hash] of bagEntry.hashes) {
            let e = $(`.file-hash.${name}`, elem);
            if (e) {
                e.textContent = hash;
            }
        }
    }

    updateBagContentsDisplay() {
        let totalCount = this.bagEntries.size;
        let totalSize = 0;
        for (let entry of this.bagEntries.values()) {
            totalSize += entry.size;
        }

        let formattedCount = `${totalCount.toLocaleString()} files`; // Flag for i18n

        $(".file-count.total", this.bagContents).textContent = formattedCount;

        $(".file-size.total", this.bagContents).textContent = filesize(
            totalSize,
            {round: 1}
        );
    }

    addSelectedFiles(files) {
        // TODO: we should reconcile the bag name form field and/or detect a common prefix on dropped directories before starting any uploads

        for (let [fullPath, file] of files) {
            let elem = this.displayBagEntry(fullPath);

            let bagEntry = new BagEntry(elem, fullPath, file);

            this.bagEntries.set(fullPath, bagEntry);

            this.updateBagEntryDisplay(bagEntry);

            this.hashFile(fullPath, file)
                .then(result => {
                    const {
                        fullPath: path,
                        sha256: hash,
                        bytesHashed,
                        elapsedMilliseconds
                    } = result;

                    bagEntry.hashes.set("sha256", hash);

                    this.dispatch({
                        type: "hash/complete",
                        path,
                        bytes: bytesHashed,
                        elapsedMilliseconds
                    });

                    this.updateBagEntryDisplay(bagEntry);

                    this.uploadPayloadFile(path, file, file.size, file.type);
                })
                .catch(function(error) {
                    // TODO: do we delete the entries entirely or offer to retry them?
                    // this.bagEntries.delete(fullPath);
                    throw error;
                });
        }

        this.updateBagContentsDisplay();
    }

    hashFile(path, file) {
        return this.hashPool.hash({fullPath: path, file});
    }

    uploadPayloadFile(path, body, size, type) {
        let uploadStartTime = performance.now();

        let progressCallback = progressEvent => {
            this.dispatch({
                type: "upload/progress",
                path,
                bytes: progressEvent.loaded,
                elapsedMilliseconds: performance.now() - uploadStartTime
            });
        };

        return this.uploadObject(
            `data/${path}`,
            body,
            size,
            type,
            progressCallback
        )
            .then(() => {
                this.dispatch({
                    type: "upload/complete",
                    path: path,
                    elapsedMilliseconds: performance.now() - uploadStartTime,
                    bytes: size
                });
            })

            .catch(err => {
                this.dispatch({
                    type: "upload/failure",
                    path,
                    elapsedMilliseconds: performance.now() - uploadStartTime,
                    message: err
                });
            });
    }

    uploadObject(path, body, size, type, progressCallback) {
        // These are part of the network settings:
        let keyPrefix = this.serverInfo.config.get("keyPrefix"),
            bucket = this.serverInfo.config.get("bucket");

        // This is user-entered:
        let bagName = this.getBagName();

        let key = `${keyPrefix}/${bagName}/${path}`;
        // Trim any leading slash from the key prefix or doubled slashes to
        // avoid S3 creating an empty “folder” and confusing clients:
        key = key.replace(/\/+/g, "/");
        key = key.replace(/^\/+/, "");

        // We reset this to zero every time so our cumulative stats will be correct
        // after failures or retries:
        this.dispatch({type: "upload/progress", path, bytesUploaded: 0});

        // TODO: set ContentMD5
        // TODO: use leavePartsOnError to allow retries?
        // TODO: make partSize and queueSize configurable
        var upload = new AWS.S3.ManagedUpload({
            maxRetries: 6,
            partSize: 8 * 1024 * 1024,
            queueSize: 4,
            params: {
                Bucket: bucket,
                Key: key,
                Body: body,
                Contenttype: type
            }
        });

        if (progressCallback) {
            upload.on("httpUploadProgress", progressCallback);
        }

        return upload.promise();
    }

    finalizeBag() {
        this.container.classList.add("finalizing");

        let uploadPromises = [];

        let totalBytes = 0;
        let totalFiles = this.bagEntries.size;

        let manifests = new Map();

        for (let [fullPath, bagEntry] of this.bagEntries) {
            if (bagEntry.statistics.upload.bytes != bagEntry.size) {
                throw `Cannot finalize bag before ${fullPath} has been uploaded!`;
            }

            totalBytes += bagEntry.size;

            for (let [hashName, hashDigest] of bagEntry.hashes) {
                if (!manifests.has(hashName)) {
                    manifests.set(hashName, []);
                }

                let manifest = manifests.get(hashName);
                manifest.push(`${hashDigest} data/${fullPath}`);
            }
        }

        for (let [hashName, entries] of manifests) {
            let body = entries.join("\n");
            uploadPromises.push(
                this.uploadObject(
                    "manifest-" + hashName + ".txt",
                    body,
                    body.length,
                    "text/plain"
                )
            );
        }

        // FIXME: Bag Info UI — https://github.com/LibraryOfCongress/bagger-js/issues/13
        let bagInfo = "Bag-Size: " + filesize(totalBytes, {round: 1});
        bagInfo += "\nPayload-Oxum: " + totalBytes + "." + totalFiles + "\n";

        let bagIt = "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n";

        // FIXME: implement tag manifests!

        uploadPromises.push(
            this.uploadObject(
                "bag-info.txt",
                bagInfo,
                bagInfo.length,
                "text/plain"
            )
        );

        uploadPromises.push(
            this.uploadObject("bagit.txt", bagIt, bagIt.length, "text/plain")
        );

        // TODO: lock the UI to prevent changes / require confirmation?

        Promise.all(uploadPromises).then(() => {
            this.container.classList.add("finalized");
            alert("ALL DONE!");
        });
    }
}