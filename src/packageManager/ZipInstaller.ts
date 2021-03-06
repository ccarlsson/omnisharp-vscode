/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as yauzl from 'yauzl';
import { EventStream } from "../EventStream";
import { InstallationStart, ZipError } from "../omnisharp/loggingEvents";
import { NestedError } from '../NestedError';
import { AbsolutePath } from './AbsolutePath';

export async function InstallZip(buffer: Buffer, description: string, destinationInstallPath: AbsolutePath, binaries: AbsolutePath[], eventStream: EventStream): Promise<void> {
    eventStream.post(new InstallationStart(description));

    return new Promise<void>((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipFile) => {
            if (err) {
                let message = "C# Extension was unable to download its dependencies. Please check your internet connection. If you use a proxy server, please visit https://aka.ms/VsCodeCsharpNetworking";
                eventStream.post(new ZipError(message));
                return reject(new NestedError(message));
            }

            zipFile.readEntry();

            zipFile.on('entry', (entry: yauzl.Entry) => {
                let absoluteEntryPath = path.resolve(destinationInstallPath.value, entry.fileName);

                if (entry.fileName.endsWith('/')) {
                    // Directory - create it
                    mkdirp(absoluteEntryPath, { mode: 0o775 }, err => {
                        if (err) {
                            return reject(new NestedError('Error creating directory for zip directory entry:' + err.code || '', err));
                        }

                        zipFile.readEntry();
                    });
                }
                else {
                    // File - extract it
                    zipFile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            return reject(new NestedError('Error reading zip stream', err));
                        }

                        mkdirp(path.dirname(absoluteEntryPath), { mode: 0o775 }, err => {
                            if (err) {
                                return reject(new NestedError('Error creating directory for zip file entry', err));
                            }

                            let binaryPaths = binaries && binaries.map(binary => binary.value);

                            // Make sure executable files have correct permissions when extracted
                            let fileMode = binaryPaths && binaryPaths.indexOf(absoluteEntryPath) !== -1
                                ? 0o755
                                : 0o664;

                            readStream.pipe(fs.createWriteStream(absoluteEntryPath, { mode: fileMode }));
                            readStream.on('end', () => zipFile.readEntry());
                        });
                    });
                }
            });

            zipFile.on('end', () => {
                resolve();
            });

            zipFile.on('error', err => {
                reject(new NestedError('Zip File Error:' + err.code || '', err));
            });
        });
    });
}

