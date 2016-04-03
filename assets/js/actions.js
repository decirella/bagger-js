import * as ActionTypes from './ActionTypes';

import * as AWS from 'aws-sdk';
import WorkerPool from '../js/worker-pool';

// http://redux.js.org/docs/basics/Actions.html

export function updateFiles(files) {
    return {
        type: ActionTypes.UPDATE_FILES,
        files
    }
}

export function updateHash(fullPath, hash) {
    return {
        type: ActionTypes.UPDATE_HASH,
        fullPath,
        hash
    }
}

export function updateBytesUploaded(fullPath, bytesUploaded) {
    return {
        type: ActionTypes.UPDATE_BYTES_UPLOADED,
        fullPath,
        bytesUploaded
    }
}

export function updateBytesHashed(fullPath, bytesHashed) {
    return {
        type: ActionTypes.UPDATE_BYTES_HASHED,
        fullPath,
        bytesHashed
    }
}

export function updateHasherStats(hasherStats) {
    return {
        type: ActionTypes.UPDATE_HASHER_STATS,
        hasherStats
    }
}

export function configStatus(status) {
    return {
        type: ActionTypes.CONFIG_STATUS,
        status
    }
}

export function updateConfig(accessKeyId, secretAccessKey, bucket, region, keyPrefix) {
    return {
        type: ActionTypes.UPDATE_CONFIG,
        accessKeyId,
        secretAccessKey,
        bucket,
        region,
        keyPrefix
    }
}

export function updateHasher(hasher) {
    return {
        type: ActionTypes.UPDATE_HASHER,
        hasher
    }
}
export function createHasher() {
    return (dispatch) => {
        const hasher = new WorkerPool('hash-worker.js', 4, (fullPath, hashed) => {
            dispatch(updateBytesHashed(fullPath, hashed))
        }, (hasherStats) => dispatch(updateHasherStats(hasherStats))
        )
        dispatch(updateHasher(hasher))
    }
}

export function addFiles(files) {
    return (dispatch, getState) => {
        const { uploader: { bucket, keyPrefix } , hasher: {hasher} } = getState()
        dispatch(updateFiles(files))
        Promise.all([...files].map(([fullPath, file]) => hasher.hash({
            file,
            fullPath,
            'action': 'hash'
        }).then(result => {
            dispatch(updateHash(fullPath, result.data.sha256))
            dispatch(upload(fullPath, file, file.size, file.type, bucket, keyPrefix))
        }).catch(function (error) {
            throw error
        })
        ));
    }
}

function configureAWS(accessKeyId, secretAccessKey, region) {
    AWS.config.update({ accessKeyId, secretAccessKey, region });
}

function getS3Client(accessKeyId, secretAccessKey, region) {
    configureAWS(accessKeyId, secretAccessKey, region);
    return new AWS.S3();
}

export function testConfiguration() {
    return (dispatch, getState) => {
        // We'd like to be able to list buckets but that's impossible due to Amazon's CORS constraints:
        // https://forums.aws.amazon.com/thread.jspa?threadID=179355&tstart=0

        const { uploader: { accessKeyId, secretAccessKey, bucket, region } } = getState()

        if (accessKeyId && secretAccessKey && region) {
            var s3 = getS3Client(accessKeyId, secretAccessKey, region);

            dispatch(configStatus({
                className: 'btn btn-info',
                message: 'Waiting…'
            }));

            s3.getBucketCors({
                Bucket: bucket
            }, (isError, data) => {
                if (isError) {
                    var errMessage = 'ERROR';

                    if (data) {
                        errMessage += ' (' + data + ')';
                    }

                    dispatch(configStatus({
                        className: 'btn btn-danger',
                        message: errMessage
                    }));

                } else {
                    dispatch(configStatus({
                        className: 'btn btn-success',
                        message: 'OK'
                    }));
                }
            });
        } else {
            dispatch(configStatus({
                className: 'btn btn-default',
                message: 'Untested'
            }));
        }
    }
}

export function upload(fullPath, body, size, type, bucket, keyPrefix) {
    return dispatch => {
        var key = keyPrefix + '/data/' + fullPath;
        key = key.replace('//', '/');

        // We reset this to zero every time so our cumulative stats will be correct
        // after failures or retries:
        dispatch(updateBytesUploaded(fullPath, 0));

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

        upload.on('httpUploadProgress', (progressEvent) => {
            // Progress should update the status bar after each chunk for visible feedback
            // on large files:
            dispatch(updateBytesUploaded(fullPath, progressEvent.loaded));
        });

        upload.send((isError) => {
            if (isError) {
                // TODO: handle error
                // Reset the total on error since S3 doesn't retain partials:
                dispatch(updateBytesUploaded(fullPath, 0));
            } else {
                dispatch(updateBytesUploaded(fullPath, size));
            }
        });
    }
}
