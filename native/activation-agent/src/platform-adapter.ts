import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { ActivationError, ActivationTarget } from '../../../packages/contracts/src/index'

const execFile = promisify(execFileCallback)

export interface AvailabilityResult { kind: 'available' | 'conflict' | 'absent'; message?: string }
export interface PlatformAdapter {
  check(target: ActivationTarget): Promise<AvailabilityResult>
  activate(target: ActivationTarget): Promise<string | null>
  deactivate(target: Pick<ActivationTarget, 'path'>, platformToken: string | null): Promise<void>
}

export class PlatformActivationError extends Error {
  constructor(public readonly detail: ActivationError) { super(detail.message) }
}

async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function verifySource(target: ActivationTarget) {
  let actual: string
  try { actual = await sha256(target.path) } catch {
    throw new PlatformActivationError({ code: 'file_missing', message: '字体文件不存在或无法读取。', retryable: false })
  }
  if (actual.toLowerCase() !== target.sha256.toLowerCase()) {
    throw new PlatformActivationError({ code: 'file_hash_changed', message: '字体文件内容已变化，请重新扫描后再激活。', retryable: false })
  }
}

function normalizedName(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, '') }

class WindowsAdapter implements PlatformAdapter {
  async installedFonts() {
    const script = `$roots=@('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'); $items=@(); foreach($root in $roots){if(Test-Path $root){$key=Get-ItemProperty $root; foreach($p in $key.PSObject.Properties){if($p.Name -notmatch '^PS'){ $path=[Environment]::ExpandEnvironmentVariables([string]$p.Value); if(-not [IO.Path]::IsPathRooted($path)){$path=Join-Path $env:WINDIR 'Fonts' $path}; $hash=$null; if(Test-Path -LiteralPath $path){try{$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash}catch{}}; $items += [pscustomobject]@{name=$p.Name;path=$path;hash=$hash}}}}}; $items | ConvertTo-Json -Compress`
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 8 * 1024 * 1024 })
    if (!stdout.trim()) return []
    const parsed = JSON.parse(stdout) as { name: string; path: string; hash: string | null } | Array<{ name: string; path: string; hash: string | null }>
    return Array.isArray(parsed) ? parsed : [parsed]
  }
  async check(target: ActivationTarget): Promise<AvailabilityResult> {
    await verifySource(target)
    const installed = await this.installedFonts()
    if (installed.some(item => item.hash?.toLowerCase() === target.sha256.toLowerCase())) return { kind: 'available' }
    const wanted = new Set(target.postscriptNames.map(normalizedName))
    if (installed.some(item => [...wanted].some(name => normalizedName(item.name).includes(name)))) return { kind: 'conflict', message: '系统中已存在相同 PostScript name 的其他字体。' }
    return { kind: 'absent' }
  }
  async activate(target: ActivationTarget) { await verifySource(target); await this.change(target.path, 'Add'); return target.path }
  async deactivate(target: Pick<ActivationTarget, 'path'>) { await this.change(target.path, 'Remove') }
  private async change(path: string, action: 'Add' | 'Remove') {
    const encodedPath = Buffer.from(path, 'utf16le').toString('base64')
    const source = `using System; using System.ComponentModel; using System.Runtime.InteropServices; public static class FontralActivation { [DllImport("gdi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern int AddFontResourceEx(string p,uint f,IntPtr r); [DllImport("gdi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool RemoveFontResourceEx(string p,uint f,IntPtr r); [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint t,out IntPtr r); static void N(){IntPtr r;SendMessageTimeout(new IntPtr(0xffff),0x001d,IntPtr.Zero,IntPtr.Zero,2,1000,out r);} public static void Add(string p){if(AddFontResourceEx(p,0,IntPtr.Zero)==0)throw new Win32Exception(Marshal.GetLastWin32Error());N();} public static void Remove(string p){if(!RemoveFontResourceEx(p,0,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());N();} }`
    const script = `$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedPath}')); Add-Type -TypeDefinition '${source.replaceAll("'", "''")}'; [FontralActivation]::${action}($p)`
    await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
  }
}

class MacAdapter implements PlatformAdapter {
  private async installedFontPaths() {
    const directories = ['/System/Library/Fonts', '/Library/Fonts', `${homedir()}/Library/Fonts`].filter(existsSync)
    if (!directories.length) return []
    const { stdout } = await execFile('find', [...directories, '-type', 'f', '(', '-iname', '*.ttf', '-o', '-iname', '*.otf', '-o', '-iname', '*.ttc', '-o', '-iname', '*.otc', ')', '-print0'], { maxBuffer: 32 * 1024 * 1024 })
    return stdout.split('\0').filter(Boolean)
  }
  async check(target: ActivationTarget): Promise<AvailabilityResult> {
    await verifySource(target)
    for (const path of await this.installedFontPaths()) {
      try {
        if ((await sha256(path)).toLowerCase() === target.sha256.toLowerCase()) return { kind: 'available' }
      } catch { /* Protected and transient files cannot participate in the hash check. */ }
    }
    const script = `ObjC.import('AppKit'); JSON.stringify(ObjC.unwrap($.NSFontManager.sharedFontManager.availableFonts))`
    const { stdout } = await execFile('osascript', ['-l', 'JavaScript', '-e', script])
    const installed = new Set((JSON.parse(stdout.trim() || '[]') as string[]).map(normalizedName))
    return target.postscriptNames.some(name => installed.has(normalizedName(name)))
      ? { kind: 'conflict', message: '系统中已存在相同 PostScript name 的其他字体。' }
      : { kind: 'absent' }
  }
  async activate(target: ActivationTarget) { await verifySource(target); await this.change(target.path, 'Register'); return target.path }
  async deactivate(target: Pick<ActivationTarget, 'path'>) { await this.change(target.path, 'Unregister') }
  private async change(path: string, action: 'Register' | 'Unregister') {
    const script = `ObjC.import('Foundation');ObjC.import('CoreText');function run(argv){const e=Ref();const u=$.NSURL.fileURLWithPath($(argv[0]));if(!$.CTFontManager${action}FontsForURL(u,$.kCTFontManagerScopeSession,e))throw new Error(e[0]?ObjC.unwrap(e[0].localizedDescription):'Core Text failed')}`
    await execFile('osascript', ['-l', 'JavaScript', '-e', script, path])
  }
}

class LinuxAdapter implements PlatformAdapter {
  async check(target: ActivationTarget): Promise<AvailabilityResult> {
    await verifySource(target)
    const { stdout } = await execFile('fc-list', ['--format=%{file}\t%{postscriptname}\n'], { maxBuffer: 16 * 1024 * 1024 })
    const entries = stdout.split(/\r?\n/).map(line => line.split('\t')).filter(item => item[0])
    for (const [path] of entries) {
      try { if ((await sha256(path!)).toLowerCase() === target.sha256.toLowerCase()) return { kind: 'available' } } catch { /* Ignore unreadable system fonts. */ }
    }
    const wanted = new Set(target.postscriptNames.map(normalizedName))
    if (entries.some(([, names]) => (names ?? '').split(',').some(name => wanted.has(normalizedName(name))))) return { kind: 'conflict', message: 'Fontconfig 中已存在相同 PostScript name 的其他字体。' }
    return { kind: 'absent' }
  }
  async activate(): Promise<string | null> {
    throw new PlatformActivationError({ code: 'unsupported_platform', message: 'Linux 不支持可靠的全局会话激活，请使用隔离启动模式。', retryable: false })
  }
  async deactivate() { /* Linux isolated mode owns no global registration. */ }
}

export class FakeAdapter implements PlatformAdapter {
  private readonly active = new Set<string>()
  async check(target: ActivationTarget): Promise<AvailabilityResult> {
    await verifySource(target)
    if (process.env.FONTRAL_FAKE_AVAILABILITY === 'available') return { kind: 'available' }
    if (process.env.FONTRAL_FAKE_AVAILABILITY === 'conflict') return { kind: 'conflict', message: 'Fake PostScript name conflict.' }
    return { kind: 'absent' }
  }
  async activate(target: ActivationTarget) {
    const delay = Number(process.env.FONTRAL_FAKE_DELAY_MS ?? 0)
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    this.active.add(target.path)
    return `fake:${basename(target.path)}`
  }
  async deactivate(target: Pick<ActivationTarget, 'path'>) { this.active.delete(target.path) }
}

export function createPlatformAdapter(): PlatformAdapter {
  if (process.env.FONTRAL_ACTIVATION_ADAPTER === 'fake') return new FakeAdapter()
  if (process.platform === 'win32') return new WindowsAdapter()
  if (process.platform === 'darwin') return new MacAdapter()
  if (process.platform === 'linux') return new LinuxAdapter()
  throw new PlatformActivationError({ code: 'unsupported_platform', message: `暂不支持 ${process.platform} 字体激活。`, retryable: false })
}
