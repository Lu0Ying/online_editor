import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import * as Y from 'yjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots')

async function ensureDir(dir) {
    try { await fs.access(dir) } catch { await fs.mkdir(dir, { recursive: true }) }
}

function getDocSnapshotDir(documentName) {
    return path.join(SNAPSHOTS_DIR, documentName)
}

export async function saveSnapshot(documentName, ydoc, author, label, message) {
    await ensureDir(SNAPSHOTS_DIR)
    const docDir = getDocSnapshotDir(documentName)
    await ensureDir(docDir)

    const now = new Date()
    const ts = now.toISOString().replace(/[:.]/g, '-')
    const id = `snap_${ts}`

    const state = Y.encodeStateAsUpdate(ydoc)
    const base64State = Buffer.from(state).toString('base64')

    const snapshot = {
        id,
        documentName,
        label: label || '无标签',
        author: author || '未知用户',
        message: message || '',
        timestamp: now.toISOString(),
        size: state.byteLength
    }

    const metaPath = path.join(docDir, `${id}.json`)
    await fs.writeFile(metaPath, JSON.stringify(snapshot, null, 2), 'utf8')

    const dataPath = path.join(docDir, `${id}.data`)
    await fs.writeFile(dataPath, base64State, 'utf8')

    console.log(`Snapshot saved: ${documentName} - ${label}`)
    return snapshot
}

export async function getSnapshots(documentName) {
    const docDir = getDocSnapshotDir(documentName)
    try {
        const files = await fs.readdir(docDir)
        const metaFiles = files.filter(f => f.endsWith('.json'))
        const snapshots = []
        for (const file of metaFiles) {
            try {
                const content = await fs.readFile(path.join(docDir, file), 'utf8')
                snapshots.push(JSON.parse(content))
            } catch {}
        }
        snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        return snapshots
    } catch {
        return []
    }
}

export async function getSnapshotData(documentName, snapshotId) {
    const docDir = getDocSnapshotDir(documentName)
    const dataPath = path.join(docDir, `${snapshotId}.data`)
    try {
        return { data: await fs.readFile(dataPath, 'utf8') }
    } catch {
        throw new Error('快照数据不存在')
    }
}

export async function deleteSnapshot(documentName, snapshotId) {
    const docDir = getDocSnapshotDir(documentName)
    await fs.unlink(path.join(docDir, `${snapshotId}.json`))
    try { await fs.unlink(path.join(docDir, `${snapshotId}.data`)) } catch {}
    console.log(`Snapshot deleted: ${documentName} - ${snapshotId}`)
}

export async function restoreSnapshotYDoc(documentName, snapshotId) {
    const docDir = getDocSnapshotDir(documentName)
    const dataPath = path.join(docDir, `${snapshotId}.data`)
    const base64State = await fs.readFile(dataPath, 'utf8')
    const state = Buffer.from(base64State, 'base64')
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, state)
    return ydoc
}
