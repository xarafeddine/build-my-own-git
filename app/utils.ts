import crypto, { BinaryToTextEncoding } from "crypto";
import fs from "fs";
import zlib from "zlib";
import { FileMode, FileSystemNode, TreeEntry } from "./types";
import { buffer } from "stream/consumers";
import path from "path";

// const encoder = new TextEncoder();
// const decoder = new TextDecoder();
// export const strToBytes = encoder.encode.bind(encoder);
// export const bytesToStr = decoder.decode.bind(decoder);

export function getProcessParams() {
  const args = process.argv.slice(2); // Skip the first two arguments
  const params: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace("--", "");
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

export function stringToBytes(s: string): Uint8Array {
  return new Uint8Array(s.split("").map((s: string) => s.charCodeAt(0)));
}
export function bytesToString(arr: Uint8Array): string {
  return Array.from(arr)
    .map((n) => String.fromCharCode(n))
    .join("");
}

export function getObjectPath(sha1: string) {
  const objectDir = sha1.substring(0, 2);
  const objectFile = sha1.substring(2);
  return [objectDir, objectFile];
}
export function getObjectData(sha1: string) {
  const [objDir, objFile] = getObjectPath(sha1);

  const objBuffer = fs.readFileSync(`.git/objects/${objDir}/${objFile}`);
  const decompressedBuffer = zlib.unzipSync(objBuffer);

  const objString = decompressedBuffer.toString();

  const [header, objContent] = objString.split("\0");
  const [objType, objSize] = header.split(" ");

  if (objType === "tree") {
    const body = decompressedBuffer.subarray(
      decompressedBuffer.indexOf("\0") + 1
    );

    const treeEntries: TreeEntry[] = [];
    let nullIndex = 0;
    for (let i = 0; i < body.length; i = nullIndex + 21) {
      const spaceIndex = body.indexOf(" ", i);
      nullIndex = body.indexOf("\0", spaceIndex);
      const mode = body.subarray(i, spaceIndex).toString();
      const name = body.subarray(spaceIndex + 1, nullIndex).toString();
      const hash = body.subarray(nullIndex + 1, nullIndex + 21).toString("hex");

      treeEntries.push({ mode, hash, name });
    }
    return { objType, objSize, objContent: treeEntries };
  }

  return { objType, objSize, objContent };
}

export function computeSHA1Hash(
  input: string | Buffer,
  option?: BinaryToTextEncoding
) {
  const shasum = crypto.createHash("sha1");
  shasum.update(input);

  return shasum.digest(option || "binary");
}

export function writeBlobObject(
  fileName: string,
  option: BinaryToTextEncoding = "hex"
) {
  const fileContent = fs.readFileSync(fileName);
  const blobFile = Buffer.from(`blob ${fileContent.length}\0${fileContent}`);

  // Compute hash for blob
  const hashedBlobFile = computeSHA1Hash(blobFile, option);

  const [blobFileDir, blobFileName] = getObjectPath(hashedBlobFile);

  const compressBlob = zlib.deflateSync(blobFile);
  fs.mkdirSync(`.git/objects/${blobFileDir}`);
  fs.writeFileSync(`.git/objects/${blobFileDir}/${blobFileName}`, compressBlob);

  return { hashedBlobFile, blobSize: fileContent.length };
}

export function writeTreeObject(node: FileSystemNode, dirPath = "") {
  let treeContent = "";
  let treeSize = 0;
  node.children?.forEach((child) => {
    if (child.type == "directory") {
      const { hashedTree, treeSize: size } = writeTreeObject(child, child.name);
      treeSize += size;
      const mode = FileMode.Directory;
      const name = child.name;
      treeContent += `${mode} ${name}\0${hashedTree}`;
    } else {
      const mode = FileMode.Regular;
      const name = child.name;
      const { hashedBlobFile, blobSize } = writeBlobObject(
        path.join(dirPath, child.name),
        "hex"
      );
      treeSize += blobSize;
      treeContent += `${mode} ${name}\0${hashedBlobFile}`;
    }
  });

  const treeBunffer = Buffer.from(`tree ${treeSize}\0${treeContent}`);

  const hashedTree = computeSHA1Hash(treeBunffer, "hex");

  const [treeObjDir, treeObjName] = getObjectPath(hashedTree);

  const compressTree = zlib.deflateSync(treeBunffer);
  fs.mkdirSync(`.git/objects/${treeObjDir}`);
  fs.writeFileSync(`.git/objects/${treeObjDir}/${treeObjName}`, compressTree);

  return { hashedTree, treeSize };
}

export function buildFileSystemTree(dirPath: string): FileSystemNode {
  const stats = fs.statSync(dirPath);
  const node: FileSystemNode = {
    name: path.basename(dirPath),
    type: stats.isDirectory() ? "directory" : "file",
  };

  if (stats.isDirectory()) {
    const children = fs.readdirSync(dirPath);
    node.children = children
      .filter((child) => child != ".git")
      .map((child) => buildFileSystemTree(path.join(dirPath, child)));
  }

  return node;
}
