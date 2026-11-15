// AudioTap - utilitaire SoundFart : capture le loopback WASAPI d'une sortie
// render (defaut : sortie Windows par defaut, ou « CABLE Input » pour le flux
// Discord) et sort le PCM float32 stereo 48 kHz sur stdout (mode « pcm »).
// Le process main le relaie au renderer via IPC -> AudioWorklet -> enregistreur :
// « ce qu'on entend » est enregistre sans repasser par le cable (pas d'echo).
//
// Compile avec csc.exe (.NET Framework) au premier usage -> tools\AudioTap.exe
//   dans le dossier de donnees (SoundFart-data portable, %APPDATA% en repli).
// Usage : AudioTap.exe [nom-du-cable] [pid-parent] [secondes] [nom-source] [mode]
//   nom-du-cable : sous-chaine du nom du peripherique render cible pour une
//                 reinjection CABLE (mode historique, non utilise par l'app).
//                 pid-parent : pid du process parent, AudioTap s'arrete si ce
//                 process disparait (anti-orphelin, verifie aussi StartTime).
//                 secondes : 0/vide = indefini. nom-source : sous-chaine d'une
//                 sortie render a capturer au lieu de la sortie par defaut.
//                 mode « pcm » : PCM brut sur stdout au lieu de la reinjection.
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

    // PROPVARIANT natif = 24 octets x64 : le marshaling par valeur d'une
    // struct sous-dimensionnee corrompt la pile. IntPtr alloue a la place ;
    // GetValue est un out-param (pas besoin de PropVariantInit, absent d'ole32).
    [DllImport("ole32.dll")] private static extern int PropVariantClear(IntPtr pvar);

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
        int GetValue(ref PropertyKey key, IntPtr pv);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey { public Guid fmtid; public int pid; }

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
                // WAVEFORMATEXTENSIBLE : cbSize a l'offset 16 doit valoir >= 22
                // avant de lire le SubFormat GUID a l'offset 24 (sinon lecture
                // hors limites sur un format malforme).
                int cbSize = Marshal.ReadInt16(p, 16);
                if (cbSize < 22) throw new Exception("WAVEFORMATEXTENSIBLE tronque (cbSize " + cbSize + ")");
                subTag = Marshal.ReadInt16(p, 24);
            }
            f.isFloat = subTag == 3;
            if (subTag != 1 && subTag != 3) throw new Exception("format audio non supporte (tag " + subTag + ", bits " + f.bits + ", canaux " + f.channels + ")");
            if (f.isFloat && f.bits != 32) throw new Exception("float " + f.bits + " bits non supporte (seul float32 est gere)");
            if (!f.isFloat && f.bits != 16 && f.bits != 24 && f.bits != 32) throw new Exception("profondeur " + f.bits + " bits non supportee");
            // channels/rate/blockAlign doivent etre > 0 : blockAlign == channels*x
            // passe avec channels=0/blockAlign=0 -> DivideByZero ou chan[-1] plus bas.
            if (f.channels < 1 || f.rate < 1 || f.blockAlign < 1)
                throw new Exception("format audio invalide (canaux " + f.channels + ", rate " + f.rate + ", blockAlign " + f.blockAlign + ")");
            // blockAlign doit correspondre a channels * bits/8 : sinon les canaux
            // seraient lus decales (padding/24-in-32) -> audio corrompu.
            if (f.blockAlign != f.channels * (f.bits / 8))
                throw new Exception("blockAlign " + f.blockAlign + " != " + f.channels + " canaux x " + (f.bits / 8) + " o");
            f.frameBytes = f.blockAlign;
            return f;
        }

        public bool SameAs(Fmt o)
        {
            // isFloat fait partie de l'identite : deux WAVEFORMATEXTENSIBLE
            // (tag 0xFFFE) int32 vs float32 ont le meme tag/channels/rate/bits
            // mais des echantillons differents — sans ce test convert=false
            // copierait des int32 comme des float32.
            return tag == o.tag && channels == o.channels && rate == o.rate && bits == o.bits && blockAlign == o.blockAlign && isFloat == o.isFloat;
        }
    }

    // Sleep(4) est arrondi a ~15,6 ms par le timer Windows par defaut : sans
    // timeBeginPeriod(1) le drain WASAPI tourne ~4x trop lent pour la periode
    // de rendu (~10 ms) — latence et risk de sous-alimentation du cable.
    [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint uPeriod);
    [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint uPeriod);

    // Decode un paquet en float[] interleave, puis reechantillonne + reencode vers dst.
    private static byte[] Convert(byte[] src, Fmt sf, Fmt df)
    {
        int sFrameBytes = sf.frameBytes, dFrameBytes = df.frameBytes;
        int sFrames = src.Length / sFrameBytes;
        int sCh = sf.channels, dCh = df.channels;
        // Le pas inter-canal est blockAlign/channels (et non bits/8) : couvre
        // les layouts avec padding sans dupliquer la verification de FromPtr.
        int samplesPer = sf.channels > 0 ? sf.blockAlign / sf.channels : sf.bits / 8;

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
                else if (sf.bits == 24)
                {
                    // PCM 24 bits little-endian, non aligne : 3 octets signes.
                    int raw = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16);
                    if ((raw & 0x800000) != 0) raw |= unchecked((int)0xFF000000); // sign-extend
                    v = raw / 8388608f;
                }
                else v = BitConverter.ToInt32(src, p) / 2147483648f;
                chan[c][i] = v;
            }
        }

        // mapping de canaux source -> destination : liste de (canal, gain) par canal cible
        var map = new List<KeyValuePair<int, float>>[dCh];
        for (int c = 0; c < dCh; c++) map[c] = new List<KeyValuePair<int, float>>();
        if (sCh == dCh)
        {
            for (int c = 0; c < dCh; c++) map[c].Add(new KeyValuePair<int, float>(c, 1f));
        }
        else if (sCh == 1)
        {
            for (int c = 0; c < dCh; c++) map[c].Add(new KeyValuePair<int, float>(0, 1f));
        }
        else if (dCh == 2 && sCh > 2)
        {
            // Downmix multicanal -> stereo : FL/FR + centre a -3 dB (0.707).
            // Ordre WASAPI : 0=FL 1=FR 2=FC 3=LFE 4=BL 5=BR ...
            // LFE et canaux arriere sont laisses de cote (dialogue = centre).
            map[0].Add(new KeyValuePair<int, float>(0, 1f));
            map[0].Add(new KeyValuePair<int, float>(2, 0.707f));
            map[1].Add(new KeyValuePair<int, float>(1, 1f));
            map[1].Add(new KeyValuePair<int, float>(2, 0.707f));
        }
        else
        {
            for (int c = 0; c < dCh; c++) map[c].Add(new KeyValuePair<int, float>(Math.Min(c, sCh - 1), 1f));
        }

        // reechantillonnage src.rate -> df.rate, par canal source.
        // Decimation (ratio > 1) : moyenne boite sur la fenetre couverte par
        // chaque echantillon de sortie — reduit l'aliasing par rapport a une
        // interpolation ponctuelle (ex. 96 -> 48 kHz). Upsampling : interpolation
        // lineaire, comportement historique conserve.
        double ratio = (double)sf.rate / df.rate;
        int dFrames = (int)Math.Ceiling(sFrames / ratio);
        var rchan = new float[sCh][];
        for (int c = 0; c < sCh; c++)
        {
            var dst = new float[dFrames];
            if (ratio > 1.0001)
            {
                for (int i = 0; i < dFrames; i++)
                {
                    int a = (int)(i * ratio);
                    int b = Math.Min((int)((i + 1) * ratio), sFrames);
                    if (b <= a) b = Math.Min(a + 1, sFrames);
                    double acc = 0;
                    for (int j = a; j < b; j++) acc += chan[c][j];
                    dst[i] = (float)(acc / (b - a));
                }
            }
            else
            {
                for (int i = 0; i < dFrames; i++)
                {
                    double pos = i * ratio;
                    int i0 = (int)pos;
                    double frac = pos - i0;
                    int i1 = Math.Min(i0 + 1, sFrames - 1);
                    if (i0 >= sFrames) i0 = sFrames - 1;
                    dst[i] = (float)(chan[c][i0] * (1 - frac) + chan[c][i1] * frac);
                }
            }
            rchan[c] = dst;
        }
        var outBuf = new byte[dFrames * dFrameBytes];
        int dSamplesPer = df.bits / 8;
        for (int i = 0; i < dFrames; i++)
        {
            int off = i * dFrameBytes;
            for (int c = 0; c < dCh; c++)
            {
                float v = 0f;
                foreach (var kv in map[c]) v += rchan[kv.Key][i] * kv.Value;
                if (v > 1f) v = 1f; else if (v < -1f) v = -1f; // clamp (somme downmix + float)
                int p = off + c * dSamplesPer;
                if (df.isFloat) Buffer.BlockCopy(BitConverter.GetBytes(v), 0, outBuf, p, 4);
                else
                {
                    if (df.bits == 16) Buffer.BlockCopy(BitConverter.GetBytes((short)(v * 32767f)), 0, outBuf, p, 2);
                    else Buffer.BlockCopy(BitConverter.GetBytes((int)(v * 2147483647f)), 0, outBuf, p, 4);
                }
            }
        }
        return outBuf;
    }

    // ------------------------- utilitaires -------------------------
    private static string DeviceName(IMMDevice dev)
    {
        // PROPVARIANT alloue en memoire non geree (24 o couvre x64 et x86) :
        // vt a l'offset 0, pointeur de la variante a l'offset 8.
        IntPtr pv = Marshal.AllocCoTaskMem(24);
        try
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(STGM_READ, out store) != 0) return "";
            PropertyKey key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
            if (store.GetValue(ref key, pv) != 0) return "";
            if (Marshal.ReadInt16(pv, 0) == 31) // VT_LPWSTR
            {
                IntPtr bstr = Marshal.ReadIntPtr(pv, 8);
                if (bstr != IntPtr.Zero) return Marshal.PtrToStringUni(bstr) ?? "";
            }
            return "";
        }
        catch { return ""; }
        finally { PropVariantClear(pv); Marshal.FreeCoTaskMem(pv); } // libere le BSTR alloue par le store
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
        // Pas de Marshal.Release(pColl) : GetObjectForIUnknown a cree un RCW, le GC s'en charge
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
    // pcmMode : au lieu de reinjecter dans le cable, ecrit du PCM float32 stereo 48 kHz
    //           sur stdout (recupere par SoundFart pour l'enregistreur, sans passer par le cable).
    // Contexte d'un flux audio initialise : clients COM, formats negocies,
    // etat de conversion. Un TapCtx n'est valable que tant que ses peripheriques
    // vivent — apres DEVICE_INVALIDATED on n'en reutilise JAMAIS un morceau.
    private sealed class TapCtx
    {
        public IAudioClient src, dst;
        public IAudioCaptureClient cap;
        public IAudioRenderClient ren;
        public Fmt sf, df;
        public bool convert;
        public uint dstBufFrames;
    }

    // Init complet : resolution des peripheriques (par nom ou defaut), activation
    // IAudioClient, GetMixFormat, Initialize, GetService, Start. Appele au demarrage
    // ET a chaque reconnexion a chaud — chaque appel repart de zero (nouveaux
    // devices, nouveaux clients COM, buffers reinitialises).
    private static TapCtx InitTap(IMMDeviceEnumerator en, string cableName, string srcName, bool pcmMode)
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
                // Pas de Marshal.Release(pColl) : RCW gere par le GC
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
        IntPtr srcFmtPtr = IntPtr.Zero;
        Fmt sf;
        try
        {
            hr = src.GetMixFormat(out srcFmtPtr);
            if (hr != 0 || srcFmtPtr == IntPtr.Zero) throw new Exception("GetMixFormat source echoue");
            sf = Fmt.FromPtr(srcFmtPtr); // peut throw -> le finally libere le format
        }
        catch { if (srcFmtPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(srcFmtPtr); throw; }

        // destination : peripherique cable (ignoree en mode pcm : sortie = stdout)
        IMMDevice dstDev = null;
        IAudioClient dst = null;
        Fmt df;
        IAudioRenderClient ren = null;
        uint dstBufFrames = 0;
        IntPtr dstFmtPtr = IntPtr.Zero;
        if (pcmMode)
        {
            // Format de sortie fixe : float32 stereo 48 kHz (ce que consomme l'enregistreur)
            df = new Fmt { tag = 3, channels = 2, rate = 48000, bits = 32, blockAlign = 8, bytesPerSec = 384000, frameBytes = 8, isFloat = true };
        }
        else
        {
            dstDev = FindRender(en, cableName);
            // Garde anti-boucle : si la source EST le cable, on reinjecterait notre propre flux.
            string srcId = null, dstId = null;
            try { srcDev.GetId(out srcId); dstDev.GetId(out dstId); }
            catch (Exception gidEx) { Console.Error.WriteLine("AudioTap: GetId: " + gidEx.Message); } // garde anti-boucle degradee, pas sautee en silence
            if (srcId != null && srcId == dstId)
                throw new Exception("la source est identique au cable « " + cableName + " » (boucle audio)");
            dst = ActivateAudio(dstDev);
            Fmt tmpDf;
            try
            {
                hr = dst.GetMixFormat(out dstFmtPtr);
                if (hr != 0 || dstFmtPtr == IntPtr.Zero) throw new Exception("GetMixFormat cable echoue");
                tmpDf = Fmt.FromPtr(dstFmtPtr);
            }
            catch { if (dstFmtPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(dstFmtPtr); dstFmtPtr = IntPtr.Zero; throw; }
            df = tmpDf;
        }
        // libere srcFmtPtr apres l'init (gere dans le finally d'Initialize)

        bool convert = !sf.SameAs(df);
        Console.Error.WriteLine("AudioTap: " + sf.channels + "ch " + sf.rate + "Hz " + sf.bits + "b"
            + (sf.isFloat ? " float" : " int") + " -> " + df.channels + "ch " + df.rate + "Hz " + df.bits + "b"
            + (df.isFloat ? " float" : " int") + (convert ? " (conversion)" : " (copie)"));

        // init capture loopback : buffer 1 s
        Console.Error.WriteLine("AudioTap: init loopback...");
        // AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM est interdit avec LOOPBACK -> E_NOTIMPL
        try
        {
            hr = src.Initialize(AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                2000000, 0, srcFmtPtr, IntPtr.Zero);
        }
        finally { Marshal.FreeCoTaskMem(srcFmtPtr); }
        Console.Error.WriteLine("AudioTap: init loopback hr=0x" + hr.ToString("X8"));
        if (hr != 0) throw new Exception("init loopback echoue (0x" + hr.ToString("X8") + ")");
        uint srcBufFrames;
        src.GetBufferSize(out srcBufFrames);
        Console.Error.WriteLine("AudioTap: srcBuf=" + srcBufFrames);

        // init rendu cable (ignore en mode pcm : pas de destination, stdout a la place)
        if (!pcmMode)
        {
            Console.Error.WriteLine("AudioTap: init cable...");
            try
            {
                hr = dst.Initialize(AUDCLNT_SHAREMODE_SHARED, 0,
                    2000000, 0, dstFmtPtr, IntPtr.Zero);
            }
            finally { Marshal.FreeCoTaskMem(dstFmtPtr); dstFmtPtr = IntPtr.Zero; }
            Console.Error.WriteLine("AudioTap: init cable hr=0x" + hr.ToString("X8"));
            if (hr != 0) throw new Exception("init cable echoue (0x" + hr.ToString("X8") + ")");
            dst.GetBufferSize(out dstBufFrames);
            Console.Error.WriteLine("AudioTap: dstBuf=" + dstBufFrames);
        }

        object svc;
        Guid gid = IID_IAudioCaptureClient;
        Console.Error.WriteLine("AudioTap: GetService capture...");
        hr = src.GetService(ref gid, out svc);
        Console.Error.WriteLine("AudioTap: GetService capture hr=0x" + hr.ToString("X8"));
        if (hr != 0) throw new Exception("GetService capture echoue");
        var cap = (IAudioCaptureClient)svc;
        if (!pcmMode)
        {
            gid = IID_IAudioRenderClient;
            Console.Error.WriteLine("AudioTap: GetService render...");
            hr = dst.GetService(ref gid, out svc);
            Console.Error.WriteLine("AudioTap: GetService render hr=0x" + hr.ToString("X8"));
            if (hr != 0) throw new Exception("GetService render echoue");
            ren = (IAudioRenderClient)svc;
        }

        Console.Error.WriteLine("AudioTap: Start...");
        hr = src.Start();
        Console.Error.WriteLine("AudioTap: src.Start hr=0x" + hr.ToString("X8"));
        if (hr != 0) { try { src.Stop(); } catch {} throw new Exception("src.Start echoue (0x" + hr.ToString("X8") + ")"); }
        if (!pcmMode)
        {
            hr = dst.Start();
            Console.Error.WriteLine("AudioTap: dst.Start hr=0x" + hr.ToString("X8"));
            if (hr != 0) { try { src.Stop(); dst.Stop(); } catch {} throw new Exception("dst.Start echoue (0x" + hr.ToString("X8") + ")"); }
        }
        Console.Error.WriteLine("AudioTap: capture demarree" + (pcmMode ? " (mode pcm -> stdout)" : ""));
        return new TapCtx { src = src, dst = dst, cap = cap, ren = ren, sf = sf, df = df, convert = convert, dstBufFrames = dstBufFrames };
    }

    private static int Run(IMMDeviceEnumerator en, string cableName, int parentPid, double seconds, string srcName, bool pcmMode)
    {
        // Init avec retries : peripherique pas encore pret (driver en cours de
        // chargement, devicechange en cours) -> on reessaie avant d'abandonner.
        TapCtx t = null;
        Exception lastInitErr = null;
        for (int att = 0; att < 5 && t == null; att++)
        {
            if (att > 0) Thread.Sleep(500 * att);
            try { t = InitTap(en, cableName, srcName, pcmMode); }
            catch (Exception ie) { lastInitErr = ie; Console.Error.WriteLine("AudioTap: init " + (att + 1) + "/5: " + ie.Message); }
        }
        if (t == null) throw lastInitErr ?? new Exception("init impossible");
        IAudioClient src = t.src, dst = t.dst;
        IAudioCaptureClient cap = t.cap;
        IAudioRenderClient ren = t.ren;
        Fmt sf = t.sf, df = t.df;
        bool convert = t.convert;
        uint dstBufFrames = t.dstBufFrames;

        var queue = new Queue<byte[]>();
        long queuedBytes = 0;
        long maxQueued = (long)(df.bytesPerSec * 0.5); // 500 ms de backlog max
        var deadline = seconds > 0 ? DateTime.UtcNow.AddSeconds(seconds) : DateTime.MaxValue;
        long statPackets = 0, statSilentPkts = 0, statBytes = 0, statPeak = 0, statWritten = 0, statPadding = -1;
        var statLast = DateTime.UtcNow;
        int lastParentTick = 0;
        bool parentDead = false;
        DateTime parentStart = DateTime.MinValue;
        // mode pcm : flux binaire stdout (bufferise, flush regulier)
        var pcmOut = pcmMode ? new System.IO.BufferedStream(Console.OpenStandardOutput(), 65536) : null;
        long pcmPending = 0;

        timeBeginPeriod(1); // granularity 1 ms pour le Sleep(4) de la boucle
        while (DateTime.UtcNow < deadline)
        {
            // Parent verifie par TEMPS (toutes les 500 ms), pas par nombre de paquets :
            // en silence aucun paquet n'arrive et l'orphelin survivrait. StartTime
            // memorise detecte la reutilisation d'un PID apres mort du parent.
            if (parentPid > 0 && Environment.TickCount - lastParentTick >= 500)
            {
                lastParentTick = Environment.TickCount;
                try
                {
                    var proc = System.Diagnostics.Process.GetProcessById(parentPid);
                    if (parentStart == DateTime.MinValue) parentStart = proc.StartTime;
                    else if (proc.StartTime != parentStart) { parentDead = true; break; }
                }
                catch { parentDead = true; break; }
            }

            // 1) aspirer les paquets disponibles
            bool wantReconnect = false;
            int sStreak = 0; // codes S_ consecutifs : borne le spin interne
            while (true)
            {
                uint packet;
                int pkHr = cap.GetNextPacketSize(out packet);
                // Seuls les codes d'echec (HRESULT negatif) sont fatals : les codes
                // S_ 0x8889xxxx (BUFFER_EMPTY, OPERATION_PENDING) sont des succes.
                if (pkHr < 0)
                {
                    Console.Error.WriteLine("AudioTap: GetNextPacketSize echoue hr=0x" + pkHr.ToString("X8") + " (peripherique invalide ?)");
                    if (pkHr == unchecked((int)0x88890004)) { wantReconnect = true; break; } // AUDCLNT_E_DEVICE_INVALIDATED
                    try { src.Stop(); if (dst != null) dst.Stop(); } catch {}
                    timeEndPeriod(1); return 2;
                }
                if (pkHr != 0) { if (++sStreak > 500) break; if (sStreak == 100) Thread.Sleep(1); continue; } // code S_ : rien a faire ce tour
                sStreak = 0;
                if (packet == 0) break;
                IntPtr data; uint frames; int flags; ulong pos, qpc;
                int gbHr = cap.GetBuffer(out data, out frames, out flags, out pos, out qpc);
                if (gbHr < 0)
                {
                    Console.Error.WriteLine("AudioTap: GetBuffer echoue hr=0x" + gbHr.ToString("X8") + " (peripherique invalide ?)");
                    if (gbHr == unchecked((int)0x88890004)) { wantReconnect = true; break; } // AUDCLNT_E_DEVICE_INVALIDATED
                    try { src.Stop(); if (dst != null) dst.Stop(); } catch {}
                    timeEndPeriod(1); return 2;
                }
                if (gbHr > 0) { if (++sStreak > 500) break; if (sStreak == 100) Thread.Sleep(1); continue; } // code S_ : pas de donnees a consommer ce tour
                sStreak = 0;
                if (frames == 0) { cap.ReleaseBuffer(0); continue; }
                int bytes = (int)(frames * sf.frameBytes);
                bool silent = (flags & 0x2) != 0;
                byte[] buf = new byte[bytes];
                if (!silent)
                {
                    Marshal.Copy(data, buf, 0, bytes);
                    // pic approximatif : max des échantillons float/int16 du 1er canal.
                    // bits==24 : échantillon non aligné de 3 octets — on saute le pic
                    // (statistique indicative) plutôt que risquer une lecture hors bornes.
                    int spb = sf.bits / 8;
                    bool peakOk = sf.isFloat || sf.bits == 16 || sf.bits == 32;
                    for (int i = 0; peakOk && i + spb <= bytes && i < frames * sf.frameBytes; i += sf.frameBytes)
                    {
                        long mag;
                        if (sf.isFloat) { float fv = BitConverter.ToSingle(buf, i); mag = (long)(Math.Abs(fv) * 1000000); }
                        else if (sf.bits == 16) mag = Math.Abs((long)BitConverter.ToInt16(buf, i));
                        else mag = Math.Abs((long)(BitConverter.ToInt32(buf, i) >> 8));
                        if (mag > statPeak) statPeak = mag;
                    }
                }
                int rbHr = cap.ReleaseBuffer(frames);
                if (rbHr < 0) Console.Error.WriteLine("AudioTap: ReleaseBuffer echoue hr=0x" + rbHr.ToString("X8"));
                statPackets++; if (silent) statSilentPkts++; statBytes += bytes;
                byte[] outBuf = convert ? Convert(buf, sf, df) : buf;
                if (outBuf.Length == 0) continue;
                if (pcmMode)
                {
                    // ecriture immediate sur stdout (le silence est deja des zeros)
                    pcmOut.Write(outBuf, 0, outBuf.Length);
                    pcmPending += outBuf.Length;
                    if (pcmPending >= 131072) { pcmOut.Flush(); pcmPending = 0; }
                    statWritten += outBuf.Length;
                    continue;
                }
                // Depassement : on jette les plus anciens paquets. La boucle
                // (et non un Dequeue unique) couvre aussi le cas ou un seul
                // paquet depasse maxQueued — sinon Dequeue sur file vide.
                while (queue.Count > 0 && queuedBytes + outBuf.Length > maxQueued)
                {
                    byte[] old = queue.Dequeue();
                    queuedBytes -= old.Length;
                }
                queue.Enqueue(outBuf);
                queuedBytes += outBuf.Length;
            }
            if (wantReconnect)
            {
                // AUDCLNT_E_DEVICE_INVALIDATED : peripherique retire ou service
                // audio reinitalise. Arret propre, re-resolution complete (l'id
                // a pu changer), re-init — borne a 5 tentatives, backoff
                // 0.5 s -> 2.5 s ; au-dela, echec net (code 2 -> tapDead).
                try { src.Stop(); if (dst != null) dst.Stop(); } catch {}
                TapCtx t2 = null;
                for (int att = 0; att < 5 && t2 == null; att++)
                {
                    Thread.Sleep(500 * (att + 1));
                    try { t2 = InitTap(en, cableName, srcName, pcmMode); }
                    catch (Exception rex) { Console.Error.WriteLine("AudioTap: reconnexion " + (att + 1) + "/5: " + rex.Message); }
                }
                if (t2 == null)
                {
                    Console.Error.WriteLine("AudioTap: reconnexion impossible apres 5 tentatives");
                    timeEndPeriod(1); return 2;
                }
                src = t2.src; dst = t2.dst; cap = t2.cap; ren = t2.ren;
                sf = t2.sf; df = t2.df; convert = t2.convert; dstBufFrames = t2.dstBufFrames;
                queue.Clear(); queuedBytes = 0; // buffers de l'ancien format : invalides
                Console.Error.WriteLine("AudioTap: reconnecte -> " + sf.channels + "ch " + sf.rate + "Hz " + sf.bits + "b -> "
                    + df.channels + "ch " + df.rate + "Hz " + df.bits + "b" + (convert ? " (conversion)" : " (copie)"));
                continue; // boucle externe : re-drain avec les nouveaux clients
            }
            if (parentDead) break;

            uint padNow;
            if (!pcmMode && dst.GetCurrentPadding(out padNow) == 0) statPadding = padNow;
            if (pcmMode && pcmPending > 0) { pcmOut.Flush(); pcmPending = 0; }
            if (DateTime.UtcNow - statLast > TimeSpan.FromSeconds(2))
            {
                statLast = DateTime.UtcNow;
                Console.Error.WriteLine("AudioTap: pkt=" + statPackets + " silent=" + statSilentPkts
                    + " bytes=" + statBytes + " peak=" + statPeak + " queued=" + queuedBytes
                    + " written=" + statWritten + " pad=" + statPadding + "/" + dstBufFrames);
                statPackets = statSilentPkts = statBytes = statPeak = statWritten = 0;
            }

            // 2) ecrire dans le cable ce qui rentre (saute en mode pcm)
            if (!pcmMode)
            {
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
                        int rgHr = ren.GetBuffer((uint)takeFrames, out rdata);
                        if (rgHr < 0)
                        {
                            Console.Error.WriteLine("AudioTap: render GetBuffer echoue hr=0x" + rgHr.ToString("X8"));
                            if (rgHr == unchecked((int)0x88890004)) { wantReconnect = true; break; } // AUDCLNT_E_DEVICE_INVALIDATED
                            try { src.Stop(); dst.Stop(); } catch {}
                            timeEndPeriod(1); return 2;
                        }
                        if (rgHr > 0) break; // code S_ : pas de buffer ce tour (symetrique au cote capture)
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
                        statWritten += takeBytes; // octets, comme le mode pcm (statWritten += outBuf.Length)
                        spaceBytes -= takeBytes;
                    }
                }
            }

            Thread.Sleep(4);
        }

        if (pcmOut != null) { try { pcmOut.Flush(); pcmOut.Dispose(); } catch {} }
        try { src.Stop(); if (dst != null) dst.Stop(); } catch {}
        Console.Error.WriteLine("AudioTap: arret");
        timeEndPeriod(1);
        return 0;
    }

    public static int Main(string[] args)
    {
        try
        {
            string cable = args.Length > 0 ? args[0] : "CABLE Input";
            int parentPid = 0;
            if (args.Length > 1) int.TryParse(args[1], out parentPid); // non numerique -> 0 = check desactive
            double seconds = 0;
            if (args.Length > 2 && !double.TryParse(args[2], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out seconds))
                throw new Exception("argument « secondes » invalide : " + args[2]);
            string srcName = args.Length > 3 && args[3].Length > 0 ? args[3] : null;
            bool pcmMode = args.Length > 4 && args[4] == "pcm";
            var en = Com<IMMDeviceEnumerator>("BCDE0395-E52F-467C-8E3D-C4579291692E");
            return Run(en, cable, parentPid, seconds, srcName, pcmMode);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERREUR: " + ex.Message);
            return 1;
        }
    }
}
