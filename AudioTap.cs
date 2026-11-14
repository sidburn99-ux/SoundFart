// AudioTap - utilitaire SoundFart : capture le loopback WASAPI du peripherique de sortie
// par defaut et le reinjecte en temps reel dans « CABLE Input » (VB-Audio Virtual Cable).
// Permet d'enregistrer « ce qu'on entend » (Discord, YouTube, jeu) via la source
// « CABLE Output » sans depender de la capture loopback Chromium (getDisplayMedia).
//
// Compile avec csc.exe (.NET Framework) au premier usage -> %APPDATA%\SoundFart\tools\AudioTap.exe
// Usage : AudioTap.exe [nom-du-cable] [secondes]
//   nom-du-cable : sous-chaine du nom du peripherique render cible (defaut "CABLE Input",
//                 le « CABLE In 16ch » est evite). secondes : 0/vide = indefini (tue par le parent).
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

internal static class AudioTap
{
    private const int DEVICE_STATE_ACTIVE = 0x1;
    private const int STGM_READ = 0;
    private const int AUDCLNT_SHAREMODE_SHARED = 0;
    private const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    private const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    private const int AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = unchecked((int)0x80000000);
    private const int AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000;
    private const int AUDCLNT_S_OK = 0;
    private const int AUDCLNT_E_BUFFER_TOO_LARGE = unchecked((int)0x88890005);
    private const int AUDCLNT_E_BUFFER_OPERATION_PENDING = unchecked((int)0x8889000F);
    private static readonly TimeSpan REFTIMES_PER_SEC = TimeSpan.FromTicks(10000000L);
    private static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    private static readonly Guid IID_IAudioRenderClient = new Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2");

    // ------------------------- COM -------------------------
    private enum DataFlow { Render = 0, Capture = 1, All = 2 }
    private enum Role { Console = 0, Multimedia = 1, Communications = 2 }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(DataFlow dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(DataFlow dataFlow, Role role, out IMMDevice ppEndpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        int GetCount(out int pcDevices);
        int Item(int nDevice, out IMMDevice ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
    }

    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        int GetCount(out int cProps);
        int GetAt(int iProp, out PropertyKey pkey);
        int GetValue(ref PropertyKey key, out PropVariant pv);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort vt; public ushort wReserved1; public ushort wReserved2; public ushort wReserved3;
        public IntPtr pointer;
    }

    [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        int Initialize(int mode, int flags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr audioSessionGuid);
        int GetBufferSize(out uint bufferFrameCount);
        int GetStreamLatency(out long hnsLatency);
        int GetCurrentPadding(out uint currentPadding);
        int IsFormatSupported(int mode, IntPtr pFormat, IntPtr ppClosestMatch);
        int GetMixFormat(out IntPtr ppDeviceFormat);
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr eventHandle);
        int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out int pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        int ReleaseBuffer(uint numFramesRead);
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    [Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioRenderClient
    {
        int GetBuffer(uint numFramesRequested, out IntPtr ppData);
        int ReleaseBuffer(uint numFramesWritten, int dwFlags);
    }

    // ------------------------- format audio -------------------------
    private sealed class Fmt
    {
        public int tag;        // 1 = PCM int, 3 = IEEE float
        public int channels;
        public int rate;
        public int bits;
        public int blockAlign;
        public int bytesPerSec;
        public int frameBytes;
        public bool isFloat;

        public static Fmt FromPtr(IntPtr p)
        {
            var f = new Fmt();
            f.tag = Marshal.ReadInt16(p, 0);
            f.channels = Marshal.ReadInt16(p, 2);
            f.rate = Marshal.ReadInt32(p, 4);
            f.bytesPerSec = Marshal.ReadInt32(p, 8);
            f.blockAlign = Marshal.ReadInt16(p, 12);
            f.bits = Marshal.ReadInt16(p, 14);
            int subTag = f.tag;
            if (f.tag == unchecked((short)0xFFFE))
            {
                // WAVEFORMATEXTENSIBLE : SubFormat GUID a l'offset 24, son premier ushort = tag
                subTag = Marshal.ReadInt16(p, 24);
            }
            f.isFloat = subTag == 3;
            if (subTag != 1 && subTag != 3) throw new Exception("format audio non supporte (tag " + subTag + ")");
            if (f.bits != 16 && f.bits != 32) throw new Exception("profondeur " + f.bits + " bits non supportee");
            f.frameBytes = f.blockAlign;
            return f;
        }

        public bool SameAs(Fmt o)
        {
            return tag == o.tag && channels == o.channels && rate == o.rate && bits == o.bits && blockAlign == o.blockAlign;
        }
    }

    // Decode un paquet en float[] interleave, puis reechantillonne + reencode vers dst.
    private static byte[] Convert(byte[] src, Fmt sf, Fmt df)
    {
        int sFrameBytes = sf.frameBytes, dFrameBytes = df.frameBytes;
        int sFrames = src.Length / sFrameBytes;
        int sCh = sf.channels, dCh = df.channels;
        int samplesPer = sf.bits / 8;

        // entrees en float par canal source
        var chan = new float[sCh][];
        for (int c = 0; c < sCh; c++) chan[c] = new float[sFrames];
        for (int i = 0; i < sFrames; i++)
        {
            int off = i * sFrameBytes;
            for (int c = 0; c < sCh; c++)
            {
                int p = off + c * samplesPer;
                float v;
                if (sf.isFloat) v = BitConverter.ToSingle(src, p);
                else if (sf.bits == 16) v = BitConverter.ToInt16(src, p) / 32768f;
                else v = BitConverter.ToInt32(src, p) / 2147483648f;
                chan[c][i] = v;
            }
        }

        // mapping de canaux source -> destination
        var map = new int[dCh];
        for (int c = 0; c < dCh; c++)
        {
            if (sCh == dCh) map[c] = c;
            else if (sCh == 1) map[c] = 0;
            else if (dCh == 2 && sCh >= 2) map[c] = c; // stereo : 2 premieres sources
            else map[c] = Math.Min(c, sCh - 1);
        }

        // reechantillonnage lineaire src.rate -> df.rate
        double ratio = (double)sf.rate / df.rate;
        int dFrames = (int)Math.Ceiling(sFrames / ratio);
        var outBuf = new byte[dFrames * dFrameBytes];
        int dSamplesPer = df.bits / 8;
        for (int i = 0; i < dFrames; i++)
        {
            double pos = i * ratio;
            int i0 = (int)pos;
            double frac = pos - i0;
            int i1 = Math.Min(i0 + 1, sFrames - 1);
            if (i0 >= sFrames) i0 = sFrames - 1;
            int off = i * dFrameBytes;
            for (int c = 0; c < dCh; c++)
            {
                int sc = map[c];
                float v = (float)(chan[sc][i0] * (1 - frac) + chan[sc][i1] * frac);
                int p = off + c * dSamplesPer;
                if (df.isFloat) Buffer.BlockCopy(BitConverter.GetBytes(v), 0, outBuf, p, 4);
                else if (df.bits == 16) Buffer.BlockCopy(BitConverter.GetBytes((short)(v * 32767f)), 0, outBuf, p, 2);
                else Buffer.BlockCopy(BitConverter.GetBytes((int)(v * 2147483647f)), 0, outBuf, p, 4);
            }
        }
        return outBuf;
    }

    // ------------------------- utilitaires -------------------------
    private static string DeviceName(IMMDevice dev)
    {
        try
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(STGM_READ, out store) != 0) return "";
            PropertyKey key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
            PropVariant pv;
            if (store.GetValue(ref key, out pv) != 0) return "";
            if (pv.vt == 31 && pv.pointer != IntPtr.Zero) return Marshal.PtrToStringUni(pv.pointer) ?? "";
            return "";
        }
        catch { return ""; }
    }

    private static T Com<T>(string clsid) where T : class
    {
        return (T)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(clsid)));
    }

    private static IMMDevice FindRender(IMMDeviceEnumerator en, string want)
    {
        IntPtr pColl;
        if (en.EnumAudioEndpoints(DataFlow.Render, DEVICE_STATE_ACTIVE, out pColl) != 0 || pColl == IntPtr.Zero)
            throw new Exception("aucun peripherique de sortie");
        var coll = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pColl);
        int count; coll.GetCount(out count);
        var matches = new List<KeyValuePair<int, IMMDevice>>();
        for (int i = 0; i < count; i++)
        {
            IMMDevice dev;
            if (coll.Item(i, out dev) != 0) continue;
            string name = DeviceName(dev);
            if (name.IndexOf(want, StringComparison.OrdinalIgnoreCase) >= 0
                && name.IndexOf("16ch", StringComparison.OrdinalIgnoreCase) < 0)
                matches.Add(new KeyValuePair<int, IMMDevice>(i, dev));
        }
        Marshal.Release(pColl);
        if (matches.Count == 0) throw new Exception("peripherique « " + want + " » introuvable");
        return matches[0].Value;
    }

    private static IAudioClient ActivateAudio(IMMDevice dev)
    {
        Guid iid = IID_IAudioClient;
        object o;
        int hr = dev.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o);
        if (hr != 0 || o == null) throw new Exception("Activate IAudioClient echoue (0x" + hr.ToString("X8") + ")");
        return (IAudioClient)o;
    }

    // ------------------------- boucle -------------------------
    private static int Run(IMMDeviceEnumerator en, string cableName, double seconds, string srcName)
    {
        // source : loopback du peripherique de sortie par defaut (ou srcName si fourni)
        IMMDevice srcDev = null;
        if (!string.IsNullOrEmpty(srcName))
        {
            IntPtr pColl;
            if (en.EnumAudioEndpoints(DataFlow.Render, DEVICE_STATE_ACTIVE, out pColl) == 0 && pColl != IntPtr.Zero)
            {
                var coll = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pColl);
                int count; coll.GetCount(out count);
                for (int i = 0; i < count && srcDev == null; i++)
                {
                    IMMDevice d;
                    if (coll.Item(i, out d) != 0) continue;
                    if (DeviceName(d).IndexOf(srcName, StringComparison.OrdinalIgnoreCase) >= 0) srcDev = d;
                }
                Marshal.Release(pColl);
            }
            if (srcDev == null) throw new Exception("sortie « " + srcName + " » introuvable");
        }
        else
        {
            int hr0 = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Console, out srcDev);
            if (hr0 != 0 || srcDev == null) throw new Exception("sortie par defaut introuvable");
        }
        int hr;
        IAudioClient src = ActivateAudio(srcDev);
        IntPtr srcFmtPtr;
        hr = src.GetMixFormat(out srcFmtPtr);
        if (hr != 0 || srcFmtPtr == IntPtr.Zero) throw new Exception("GetMixFormat source echoue");
        Fmt sf = Fmt.FromPtr(srcFmtPtr);
        // on garde srcFmtPtr : loopback exige parfois le format explicite

        // destination : peripherique cable
        IMMDevice dstDev = FindRender(en, cableName);
        IAudioClient dst = ActivateAudio(dstDev);
        IntPtr dstFmtPtr;
        hr = dst.GetMixFormat(out dstFmtPtr);
        if (hr != 0 || dstFmtPtr == IntPtr.Zero) throw new Exception("GetMixFormat cable echoue");
        Fmt df = Fmt.FromPtr(dstFmtPtr);

        bool convert = !sf.SameAs(df);
        Console.Error.WriteLine("AudioTap: " + sf.channels + "ch " + sf.rate + "Hz " + sf.bits + "b"
            + (sf.isFloat ? " float" : " int") + " -> " + df.channels + "ch " + df.rate + "Hz " + df.bits + "b"
            + (df.isFloat ? " float" : " int") + (convert ? " (conversion)" : " (copie)"));

        // init capture loopback : buffer 1 s
        Console.Error.WriteLine("AudioTap: init loopback...");
        // AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM est interdit avec LOOPBACK -> E_NOTIMPL
        hr = src.Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            2000000, 0, srcFmtPtr, IntPtr.Zero);
        Console.Error.WriteLine("AudioTap: init loopback hr=0x" + hr.ToString("X8"));
        Marshal.FreeCoTaskMem(srcFmtPtr);
        if (hr != 0) throw new Exception("init loopback echoue (0x" + hr.ToString("X8") + ")");
        uint srcBufFrames;
        src.GetBufferSize(out srcBufFrames);
        Console.Error.WriteLine("AudioTap: srcBuf=" + srcBufFrames);

        // init rendu cable
        Console.Error.WriteLine("AudioTap: init cable...");
        hr = dst.Initialize(AUDCLNT_SHAREMODE_SHARED, 0,
            2000000, 0, dstFmtPtr, IntPtr.Zero);
        Console.Error.WriteLine("AudioTap: init cable hr=0x" + hr.ToString("X8"));
        Marshal.FreeCoTaskMem(dstFmtPtr);
        if (hr != 0) throw new Exception("init cable echoue (0x" + hr.ToString("X8") + ")");
        uint dstBufFrames;
        dst.GetBufferSize(out dstBufFrames);
        Console.Error.WriteLine("AudioTap: dstBuf=" + dstBufFrames);

        object svc;
        Guid gid = IID_IAudioCaptureClient;
        Console.Error.WriteLine("AudioTap: GetService capture...");
        hr = src.GetService(ref gid, out svc);
        Console.Error.WriteLine("AudioTap: GetService capture hr=0x" + hr.ToString("X8"));
        if (hr != 0) throw new Exception("GetService capture echoue");
        var cap = (IAudioCaptureClient)svc;
        gid = IID_IAudioRenderClient;
        Console.Error.WriteLine("AudioTap: GetService render...");
        hr = dst.GetService(ref gid, out svc);
        Console.Error.WriteLine("AudioTap: GetService render hr=0x" + hr.ToString("X8"));
        if (hr != 0) throw new Exception("GetService render echoue");
        var ren = (IAudioRenderClient)svc;

        Console.Error.WriteLine("AudioTap: Start...");
        hr = src.Start();
        Console.Error.WriteLine("AudioTap: src.Start hr=0x" + hr.ToString("X8"));
        hr = dst.Start();
        Console.Error.WriteLine("AudioTap: dst.Start hr=0x" + hr.ToString("X8"));
        Console.Error.WriteLine("AudioTap: capture demarree");

        var queue = new Queue<byte[]>();
        long queuedBytes = 0;
        long maxQueued = (long)(df.bytesPerSec * 0.5); // 500 ms de backlog max
        var deadline = seconds > 0 ? DateTime.UtcNow.AddSeconds(seconds) : DateTime.MaxValue;
        long statPackets = 0, statSilentPkts = 0, statBytes = 0, statPeak = 0, statWritten = 0, statPadding = -1;
        var statLast = DateTime.UtcNow;

        while (DateTime.UtcNow < deadline)
        {
            // 1) aspirer les paquets disponibles
            uint packet;
            while (cap.GetNextPacketSize(out packet) == 0 && packet > 0)
            {
                IntPtr data; uint frames; int flags; ulong pos, qpc;
                if (cap.GetBuffer(out data, out frames, out flags, out pos, out qpc) != 0) break;
                int bytes = (int)(frames * sf.frameBytes);
                bool silent = (flags & 0x2) != 0;
                byte[] buf = new byte[bytes];
                if (!silent)
                {
                    Marshal.Copy(data, buf, 0, bytes);
                    // pic approximatif : max des échantillons float/int16 du 1er canal
                    int spb = sf.bits / 8;
                    for (int i = 0; i + spb <= bytes && i < frames * sf.frameBytes; i += sf.frameBytes)
                    {
                        long mag;
                        if (sf.isFloat) { float fv = BitConverter.ToSingle(buf, i); mag = (long)(Math.Abs(fv) * 1000000); }
                        else if (sf.bits == 16) mag = Math.Abs((long)BitConverter.ToInt16(buf, i));
                        else mag = Math.Abs((long)(BitConverter.ToInt32(buf, i) >> 8));
                        if (mag > statPeak) statPeak = mag;
                    }
                }
                cap.ReleaseBuffer(frames);
                statPackets++; if (silent) statSilentPkts++; statBytes += bytes;
                byte[] outBuf = convert ? Convert(buf, sf, df) : buf;
                if (queuedBytes + outBuf.Length > maxQueued)
                {
                    // depassement : on jette le plus ancien paquet
                    byte[] old = queue.Dequeue();
                    queuedBytes -= old.Length;
                }
                queue.Enqueue(outBuf);
                queuedBytes += outBuf.Length;
            }

            uint padNow;
            if (dst.GetCurrentPadding(out padNow) == 0) statPadding = padNow;
            if (DateTime.UtcNow - statLast > TimeSpan.FromSeconds(2))
            {
                statLast = DateTime.UtcNow;
                Console.Error.WriteLine("AudioTap: pkt=" + statPackets + " silent=" + statSilentPkts
                    + " bytes=" + statBytes + " peak=" + statPeak + " queued=" + queuedBytes
                    + " written=" + statWritten + " pad=" + statPadding + "/" + dstBufFrames);
                statPackets = statSilentPkts = statBytes = statPeak = statWritten = 0;
            }

            // 2) ecrire dans le cable ce qui rentre
            uint padding;
            if (dst.GetCurrentPadding(out padding) == 0)
            {
                long spaceBytes = (long)(dstBufFrames - padding) * df.frameBytes;
                while (queue.Count > 0 && queuedBytes >= df.frameBytes)
                {
                    byte[] head = queue.Peek();
                    int takeFrames = (int)Math.Min(spaceBytes / df.frameBytes, head.Length / df.frameBytes);
                    if (takeFrames <= 0) break;
                    int takeBytes = takeFrames * df.frameBytes;
                    IntPtr rdata;
                    if (ren.GetBuffer((uint)takeFrames, out rdata) != 0) break;
                    if (takeBytes == head.Length)
                    {
                        Marshal.Copy(head, 0, rdata, takeBytes);
                        queue.Dequeue();
                        queuedBytes -= takeBytes;
                    }
                    else
                    {
                        Marshal.Copy(head, 0, rdata, takeBytes);
                        byte[] rest = new byte[head.Length - takeBytes];
                        Buffer.BlockCopy(head, takeBytes, rest, 0, rest.Length);
                        queue.Dequeue();
                        queue.Enqueue(rest);
                        queuedBytes -= takeBytes;
                    }
                    ren.ReleaseBuffer((uint)takeFrames, 0);
                    statWritten += takeFrames;
                    spaceBytes -= takeBytes;
                }
            }

            Thread.Sleep(4);
        }

        try { src.Stop(); dst.Stop(); } catch {}
        Console.Error.WriteLine("AudioTap: arret");
        return 0;
    }

    public static int Main(string[] args)
    {
        try
        {
            string cable = args.Length > 0 ? args[0] : "CABLE Input";
            double seconds = args.Length > 1 ? double.Parse(args[1]) : 0;
            string srcName = args.Length > 2 ? args[2] : null;
            var en = Com<IMMDeviceEnumerator>("BCDE0395-E52F-467C-8E3D-C4579291692E");
            return Run(en, cable, seconds, srcName);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERREUR: " + ex.Message);
            return 1;
        }
    }
}
