import path, { resolve } from "path";
import { fromBuffer } from "file-type";
import isSvg from "is-svg";
import { createHash } from "crypto";
const fs2 = require('fs').promises;
import fs from "fs";
 
 
import {
  FORBIDDEN_SYMBOLS_FILENAME_PATTERN,
  MD_LINK,
  USER_AGENT,
  NOTICE_TIMEOUT,
  APP_TITLE,
  VERBOSE,
  ATT_SIZE_ACHOR
} from "./config";

import {
  requestUrl,
  Notice,
  TFile
} from "obsidian";

import { pLimit } from "./downloadPool";

// How many attachment tags are processed at once. Bounding this keeps peak
// memory flat (one buffered download per slot instead of every image in the
// note held in memory simultaneously) and stops the renderer from being
// saturated when a clipped article carries dozens of images.
const PROCESS_CONCURRENCY = 3;
 

//import { TIMEOUT } from "dns";
//import fs from "fs";


/*
https://stackoverflow.com/a/48032528/1020973
It will be better to do it type-correct.
*/


export async function showBalloon(str: string, show: boolean = true, timeout = NOTICE_TIMEOUT) {
  if (show) {
    new Notice(APP_TITLE + "\r\n" + str, timeout);
  };
}


export function displayError(error: Error | string, file?: TFile): void {
  if (file) {
    showBalloon(`LocalImagesPlus: Error while handling file ${file.name}, ${error.toString()}`);
  } else {
    showBalloon(error.toString());
  }

  logError(`LocalImagesPlus: error: ${error}`, false);
}

export async function logError(str: any, isObj: boolean = false) {

  if (VERBOSE) {

    console.log(APP_TITLE + ":  ");

    if (isObj) {
      console.table(str);
    }
    else {
      console.log(str);
    }
  }
};

export function md5Sig(contentData: ArrayBuffer = undefined) {

  try {

    // Node's native crypto is much faster than the crypto-js implementation
    // this used historically. The chunk-sampling + lossy utf-8 decode is kept
    // byte-identical because existing vault attachments are NAMED by this
    // hash — changing the algorithm would orphan every previously
    // downloaded file on reprocess.
    var dec = new TextDecoder("utf-8");
    const arrMid = Math.round(contentData.byteLength / 2);
    const chunk = 15000;
    const joined = [
      contentData.slice(0, chunk),
      contentData.slice(arrMid, arrMid + chunk),
      contentData.slice(-chunk)
    ].map(x => dec.decode(x)).join();

    const signature = createHash("md5").update(joined, "utf8").digest("hex");

    return signature + "_MD5";
  }
  catch (e) {

    logError("Cannot generate md5: " + e, false);
    return null;
  }

}


export async function replaceAsync(str: any, regex: Array<RegExp>, asyncFn: any) {

  logError("replaceAsync: \r\nstr: " + str + "\r\nregex: ")
  logError(regex, true);

  let errorflag = false;
  const promises: Promise<any>[] = [];
  let dictPatt: Array<any>[] = [];
  let link;
  let anchor;
  let replp: any;
  let caption = "";
  let filesArr: Array<string> = [];
  let AttSize = "";

  regex.forEach((element) => {
    logError("cur regex:  " + element);
    const matches = str.matchAll(element);

    for (const match of matches) {
      logError("match: " + match)
    
      anchor = trimAny(match.groups.anchor, [")", "(", "]", "[", " "]); 
      
       
      const AttSizeMatch = anchor.matchAll(ATT_SIZE_ACHOR);
       
      for (const match of AttSizeMatch) {
 
         AttSize = (match.groups.attsize !== undefined) ?  trimAny(match.groups.attsize, [")", "(", "]", "[", " "] ): 
                   (match.groups.attsize2 !== undefined) ?  trimAny(match.groups.attsize2, [")", "(", "]", "[", " "] ): 
         ""; 
        }
         

      link = (match.groups.link.match(MD_LINK) ?? [match.groups.link])[0];
      caption = trimAny((match.groups.link.match(MD_LINK) !== null ?
        (match.groups.link.split(link).length > 1 ?
          match.groups.link.split(link)[1] : "") :
        ""), [")", "]", "(", "[", " "]);
      link = trimAny(link, [")", "(", "]", "[", " "]);
      replp = trimAny(match[0], ["[", "(", "]"]);

      logError(
        "repl: " + replp +
        "\r\nahc: " + anchor +
        "\r\nlink: " + link +
        "\r\ncaption: " + caption + 
        "\r\nAttSize: " + AttSize);

      dictPatt[replp] = [anchor, link, caption, AttSize];

    };

  })

  const limit = pLimit(PROCESS_CONCURRENCY);
  for (var key in dictPatt) {
    const args = dictPatt[key];
    const promise = limit(() => asyncFn(key, args[0], args[1], args[2], args[3]));
    promises.push(promise);
  }

  const data = await Promise.all(promises);
  logError("Promises: ");
  logError(data, true);

  // Replacement pairs [search, replace] — returned so the caller can
  // re-apply them atomically (vault.process) against the file's current
  // content instead of overwriting with a stale snapshot.
  const pairs: Array<[string, string]> = [];

  data.forEach((element) => {

    if (element !== null) {

      logError("el: " + element[0] + "  el2: " + element[1] + element[2]);
      str = str.replaceAll(element[0], element[1] + element[2]);
      pairs.push([element[0], element[1] + element[2]]);
      filesArr.push(element[1]);
    }
    else {
      errorflag = true;
    }

  });

  return [str, errorflag, filesArr, pairs];
}

export function isUrl(link: string) {
  logError("IsUrl: " + link, false);
  try {
    return Boolean(new URL(link));
  } catch (_) {
    return false;
  }
}






export async function copyFromDisk(src: string, dest: string): Promise<null> {
  logError("copyFromDisk: " + src + " to " + dest, false);
  try {
    await fs.copyFile(src, dest, null, (err: Error) => {
      if (err) {
        logError("Error:" + err, false);
      }

    });
  }
  catch (e) {
    logError("Cannot copy: " + e, false);
    return null;
  }
}


 

export async function base64ToBuff(data: string): Promise<ArrayBuffer> {
  logError("base64ToBuff: \r\n", false);
  try {
    const BufferData = Buffer.from(data.split("base64,")[1], 'base64');
    logError(BufferData);
    return BufferData;
  }
  catch (e) {

    logError("Cannot read base64: " + e, false);
    return null;
  }
}

export async function readFromDiskB(file: string, count: number = undefined): Promise<Buffer> {

  try {
    const buffer = Buffer.alloc(count);
    const fd: number = fs.openSync(file, "r+")
    fs.readSync(fd, buffer, 0, buffer.length, 0)
    logError(buffer)
    fs.closeSync(fd)
    return buffer

  } catch (e) {
    logError("Cannot read the file: " + e, false);
    return null
  }



}


export async function readFromDisk(file: string): Promise<ArrayBuffer> {
  logError("readFromDisk: " + file, false);

  try {
    const data = await fs2.readFile(file, null);
    return Buffer.from(data);
  }
  catch (e) {

    logError("Cannot read the file: " + e, false);
    return null;
  }
}

export async function downloadImage(url: string): Promise<ArrayBuffer> {

  logError("Downloading: " + url, false);
  const headers = {
    'method': 'GET',
    'User-Agent': USER_AGENT
  }

  try {
    const res = await requestUrl({ url: url, headers })
    logError(res, true);
    return res.arrayBuffer;
  }
  catch (e) {
    logError("Cannot download the file: " + e, false);
    return null;
  }
}

export async function getFileExt(content: ArrayBuffer, link: string) {

  const fileExtByLink = path.extname(link).replace("\.", "");
  const fileExtByBuffer = (await fromBuffer(content))?.ext;

  // if XML, probably it is SVG
  if (fileExtByBuffer == "xml" || !fileExtByBuffer) {
    const buffer = Buffer.from(content);
    if (isSvg(buffer)) return "svg";
  }


  logError("fileExtByBuffer"+fileExtByBuffer)

  if (fileExtByBuffer != undefined && fileExtByBuffer && fileExtByBuffer.length <= 5 && fileExtByBuffer?.length > 0) {
    return fileExtByBuffer;
  }

  logError("fileExtByLink  " +fileExtByLink)
  
  if (fileExtByLink != undefined  && fileExtByLink.length <= 5 && fileExtByLink?.length > 0) {
    return fileExtByLink;
  }

  return "unknown";
}


//https://stackoverflow.com/questions/26156292/trim-specific-character-from-a-string

export function trimAny(str: string, chars: Array<string>) {
  var start = 0,
    end = str.length;

  while (start < end && chars.indexOf(str[start]) >= 0)
    ++start;

  while (end > start && chars.indexOf(str[end - 1]) >= 0)
    --end;

  return (start > 0 || end < str.length) ? str.substring(start, end) : str;
}


export function cFileName(name: string, sep:string = " ") {
  const cleanedName = name.replace(
    /(\)|\(|\"|\'|\#|\]|\[|\:|\>|\<|\*|\|)/g,
    sep
  );
  return cleanedName;
}
 
export function pathJoin(parts: Array<string>): string {
  const result = path.join(...parts);
  // it seems that obsidian do not understand paths with backslashes in Windows, so turn them into forward slashes
  return result.replace(/\\/g, "/");
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

export function encObsURI(e: string) {
  return e.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, (function (e) {
    return encodeURIComponent(e)
  }
  ))
}




/**
 * Re-encode an image blob to the given type/quality.
 *
 * Uses createImageBitmap + OffscreenCanvas.convertToBlob: fully async (the
 * encode does not block the renderer the way canvas.toDataURL did), no
 * base64/data-URL round-trips, and a decode failure resolves to null
 * instead of hanging forever.
 *
 * @param blob - The Blob object to convert.
 * @param imgQuality - The quality of the image (0 to 1).
 * @param imgType - Target mime type, e.g. "image/jpeg" or "image/webp".
 * @returns ArrayBuffer of the converted image, or null on failure.
 */
export async function blobToJpegArrayBuffer(blob: Blob, imgQuality: number, imgType: string = "image/jpeg"): Promise<ArrayBuffer | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get 2D context.");
    }

    // White backdrop so transparent PNG regions don't turn black in JPEG.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);

    const outBlob = await canvas.convertToBlob({ type: imgType, quality: imgQuality });
    return await outBlob.arrayBuffer();
  }
  catch (e) {
    logError("Image conversion failed: " + e, false);
    return null;
  }
  finally {
    bitmap?.close();
  }
}

 