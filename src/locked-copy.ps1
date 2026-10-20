param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class RundelLockedCopy {
  const int SystemExtendedHandleInformation = 64;
  const uint StatusInfoLengthMismatch = 0xC0000004;
  const int ProcessDupHandle = 0x40;
  const uint DuplicateSameAccess = 0x2;

  [StructLayout(LayoutKind.Sequential)]
  struct Entry {
    public IntPtr Object;
    public IntPtr UniqueProcessId;
    public IntPtr HandleValue;
    public int GrantedAccess;
    public short CreatorBackTraceIndex;
    public short ObjectTypeIndex;
    public int HandleAttributes;
    public int Reserved;
  }

  [DllImport("ntdll.dll")]
  static extern uint NtQuerySystemInformation(int cls, IntPtr info, int len, out int retLen);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(int access, bool inherit, int pid);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DuplicateHandle(IntPtr srcProc, IntPtr srcHandle, IntPtr dstProc, out IntPtr dup, int access, bool inherit, uint options);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int GetFinalPathNameByHandle(IntPtr handle, StringBuilder buffer, int capacity, int flags);

  public static bool Copy(string needle, string dest, string processNames) {
    if (IntPtr.Size != 8) return false;
    var pids = new HashSet<int>();
    foreach (var name in (processNames ?? "chrome,msedge,browser").Split(',')) {
      foreach (var process in Process.GetProcessesByName(name.Trim())) pids.Add(process.Id);
    }
    if (pids.Count == 0) return false;

    int size = 1 << 20;
    IntPtr buffer = IntPtr.Zero;
    uint status;
    int returned;
    do {
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
      size *= 2;
      buffer = Marshal.AllocHGlobal(size);
      status = NtQuerySystemInformation(SystemExtendedHandleInformation, buffer, size, out returned);
    } while (status == StatusInfoLengthMismatch && size < 64 * 1024 * 1024);

    if (status != 0) {
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
      return false;
    }

    long count = Marshal.ReadInt64(buffer);
    int entrySize = Marshal.SizeOf(typeof(Entry));
    IntPtr start = IntPtr.Add(buffer, IntPtr.Size * 2);
    bool copied = false;
    for (long i = 0; i < count && !copied; i++) {
      Entry entry = (Entry)Marshal.PtrToStructure(IntPtr.Add(start, (int)(i * entrySize)), typeof(Entry));
      int pid = entry.UniqueProcessId.ToInt32();
      if (!pids.Contains(pid)) continue;
      IntPtr process = OpenProcess(ProcessDupHandle, false, pid);
      if (process == IntPtr.Zero) continue;
      IntPtr dup;
      if (DuplicateHandle(process, entry.HandleValue, GetCurrentProcess(), out dup, 0, false, DuplicateSameAccess)) {
        var name = new StringBuilder(1024);
        if (GetFinalPathNameByHandle(dup, name, name.Capacity, 0) > 0 && SameFile(name.ToString(), needle)) {
          using (var input = new FileStream(new SafeFileHandle(dup, true), FileAccess.Read))
          using (var output = File.Create(dest)) {
            input.CopyTo(output);
          }
          dup = IntPtr.Zero;
          copied = true;
        }
        if (dup != IntPtr.Zero) CloseHandle(dup);
      }
      CloseHandle(process);
    }
    Marshal.FreeHGlobal(buffer);
    return copied;
  }

  static bool SameFile(string handlePath, string needle) {
    string left = handlePath;
    if (left.StartsWith(@"\\?\")) left = left.Substring(4);
    left = left.TrimEnd('\\');
    string right = needle.TrimEnd('\\');
    return left.Equals(right, StringComparison.OrdinalIgnoreCase);
  }
}
"@

if (-not [RundelLockedCopy]::Copy($Source, $Destination, "chrome,msedge,browser")) {
  exit 2
}
