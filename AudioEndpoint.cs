// AudioEndpoint - utilitaire SoundFart : liste / lit / change le peripherique audio par defaut Windows.
// Compile avec csc.exe (framework .NET) au premier usage, dans tools\ du dossier
// de donnees (SoundFart-data portable, %APPDATA%\SoundFart en repli).
// Usage :
//   AudioEndpoint.exe list                 -> lignes "flow|id|nom" pour les peripheriques actifs
//   AudioEndpoint.exe get <render|capture>  -> "console=<id>" puis "comm=<id>" du peripherique par defaut
//   AudioEndpoint.exe set <render|capture> <id> -> definie le peripherique par defaut (roles console + multimedia + communications)
//   AudioEndpoint.exe restore <json>        -> restaure depuis un fichier audio-restore.json
//   AudioEndpoint.exe guard <pid> <json>    -> process detache : attend la mort du parent
//        (pid + StartTime, anti-reutilisation) puis restaure si le marqueur owner correspond
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

internal static class AudioEndpoint
{
    private const int DEVICE_STATE_ACTIVE = 0x1;
    private const int STGM_READ = 0;

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
    private struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr pointer;
    }

    [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
        int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int mode, IntPtr ppFormat);
        int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
        int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr pMixFormat);
        int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int mode, IntPtr phnsDefaultPeriod, IntPtr phnsMinimumPeriod);
        int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr phnsPeriod);
        int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
        int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr mode);
        int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref PropertyKey key, IntPtr pv);
        int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref PropertyKey key, IntPtr pv);
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, Role role);
        int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
    }

    private static readonly PropertyKey FriendlyNameKey = new PropertyKey
    {
        fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
        pid = 14 // PKEY_Device_FriendlyName
    };

    private static string DeviceName(IMMDevice dev)
    {
        try
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(STGM_READ, out store) != 0) return "";
            PropertyKey key = FriendlyNameKey;
            PropVariant pv;
            if (store.GetValue(ref key, out pv) != 0) return "";
            if (pv.vt == 31 && pv.pointer != IntPtr.Zero) // VT_LPWSTR
                return Marshal.PtrToStringUni(pv.pointer) ?? "";
            return "";
        }
        catch { return ""; }
    }

    private static void List(IMMDeviceEnumerator en)
    {
        foreach (DataFlow flow in new[] { DataFlow.Render, DataFlow.Capture })
        {
            IntPtr pColl;
            if (en.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out pColl) != 0 || pColl == IntPtr.Zero) continue;
            var coll = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pColl);
            int count;
            coll.GetCount(out count);
            for (int i = 0; i < count; i++)
            {
                IMMDevice dev;
                if (coll.Item(i, out dev) != 0) continue;
                string id, name;
                dev.GetId(out id);
                name = DeviceName(dev);
                Console.WriteLine((flow == DataFlow.Render ? "render" : "capture") + "|" + id + "|" + name.Replace("\n", " ").Replace("|", "/"));
            }
            // Pas de Marshal.Release(pColl) : GetObjectForIUnknown a cree un RCW
            // dont le finaliseur libere la reference (meme convention qu'AudioTap.cs).
        }
    }

    private static void GetDefault(IMMDeviceEnumerator en, DataFlow flow)
    {
        foreach (Role role in new[] { Role.Console, Role.Multimedia, Role.Communications })
        {
            IMMDevice dev;
            string id = "";
            if (en.GetDefaultAudioEndpoint(flow, role, out dev) == 0 && dev != null)
                dev.GetId(out id);
            Console.WriteLine((role == Role.Console ? "console" : role == Role.Multimedia ? "multi" : "comm") + "=" + id);
        }
    }

    private static T Com<T>(string clsid) where T : class
    {
        return (T)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(clsid)));
    }

    private static void SetDefault(DataFlow flow, string idConsole, string idComm, string idMulti)
    {
        var policy = Com<IPolicyConfig>("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9");
        int hr1 = policy.SetDefaultEndpoint(idConsole, Role.Console);
        int hr2 = policy.SetDefaultEndpoint(idComm, Role.Communications);
        int hr3 = string.IsNullOrEmpty(idMulti) ? 0 : policy.SetDefaultEndpoint(idMulti, Role.Multimedia);
        if (hr1 != 0 && hr2 != 0 && hr3 != 0)
            throw new Exception("SetDefaultEndpoint a echoue (0x" + hr1.ToString("X8") + ")");
    }

    // Mode « guard <pid> <fichier-restore.json> » : processus detache lance au moment de la
    // bascule micro. Il attend la mort du process parent (crash/kill de SoundFart) puis
    // restaure l'entree capture depuis le fichier JSON, avec la meme priorite que
    // restoreMicNow() de main.js : defaut Windows non virtuel > ids d'origine > 1er non virtuel.
    // Ne fait rien si le fichier a deja ete consomme (fermeture propre) ou si le champ
    // « owner » ne correspond pas au pid parent (un autre SoundFart a repris la bascule).
    private static readonly System.Text.RegularExpressions.Regex VIRTUAL_RE =
        new System.Text.RegularExpressions.Regex("cable|virtual|voicemeeter|vb-audio", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private static bool NonVirtual(string id, System.Collections.Generic.List<KeyValuePair<string, string>> caps)
    {
        if (string.IsNullOrEmpty(id)) return false;
        foreach (var kv in caps) if (kv.Key == id) return !VIRTUAL_RE.IsMatch(kv.Value ?? "");
        return false;
    }

    // Restauration immediate depuis un fichier audio-restore.json (utilisee par le
    // mode 'restore' et par 'guard' apres la mort du parent). Retourne 0 si le
    // fichier a ete consomme, 1 sinon.
    private static int RestoreFromFile(IMMDeviceEnumerator en, string restorePath)
    {
        try
        {
            if (!System.IO.File.Exists(restorePath)) return 0; // rien a faire
            string json = System.IO.File.ReadAllText(restorePath);
            var caps = new System.Collections.Generic.List<KeyValuePair<string, string>>();
            IntPtr pColl;
            if (en.EnumAudioEndpoints(DataFlow.Capture, DEVICE_STATE_ACTIVE, out pColl) != 0 || pColl == IntPtr.Zero) return 1;
            var coll = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pColl);
            int count; coll.GetCount(out count);
            for (int i = 0; i < count; i++)
            {
                IMMDevice d;
                if (coll.Item(i, out d) != 0) continue;
                string id; d.GetId(out id);
                caps.Add(new KeyValuePair<string, string>(id, DeviceName(d)));
            }
            var g = new string[3];
            GetDefault(en, DataFlow.Capture, g);
            string prevC = RegexVal(json, "console"), prevM = RegexVal(json, "comm");
            string defId = NonVirtual(g[1], caps) ? g[1] : ""; // role multimedia = defaut Windows fiable
            string fb = "";
            foreach (var kv in caps) if (!VIRTUAL_RE.IsMatch(kv.Value ?? "")) { fb = kv.Key; break; }
            string cId = defId != "" ? defId : (NonVirtual(prevC, caps) ? prevC : "") ;
            if (cId == "") cId = fb;
            string mId = defId != "" ? defId : (NonVirtual(prevM, caps) ? prevM : "");
            if (mId == "") mId = fb;
            if (cId == "" && mId == "") return 1; // aucun micro : on garde le fichier pour retry ulterieur
            SetDefault(DataFlow.Capture, cId != "" ? cId : mId, mId != "" ? mId : cId, defId != "" ? defId : (cId != "" ? cId : mId));
            try { System.IO.File.Delete(restorePath); } catch {}
            return 0;
        }
        catch { return 1; }
    }

    private static int Guard(IMMDeviceEnumerator en, int pid, string restorePath)
    {
        // Attente de la mort du parent (poll 500 ms). On memorise StartTime pour
        // detecter une reutilisation du PID par un autre processus (comme AudioTap).
        DateTime startTime;
        try { startTime = System.Diagnostics.Process.GetProcessById(pid).StartTime; }
        catch { return 0; }
        for (;;)
        {
            try
            {
                var proc = System.Diagnostics.Process.GetProcessById(pid);
                if (proc.StartTime != startTime) return 0; // PID reutilise : ce n'est plus notre parent
            }
            catch { break; }
            System.Threading.Thread.Sleep(500);
        }
        // owner : le guard ne restaure que si c'est bien SA bascule qui est enregistree
        try
        {
            if (!System.IO.File.Exists(restorePath)) return 0;
            string json = System.IO.File.ReadAllText(restorePath);
            var mOwner = System.Text.RegularExpressions.Regex.Match(json, "\"owner\"\\s*:\\s*(\\d+)");
            if (mOwner.Success && mOwner.Groups[1].Value != pid.ToString()) return 0;
        }
        catch { return 0; }
        return RestoreFromFile(en, restorePath);
    }

    private static string RegexVal(string json, string key)
    {
        var m = System.Text.RegularExpressions.Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
        return m.Success ? m.Groups[1].Value : "";
    }

    private static void GetDefault(IMMDeviceEnumerator en, DataFlow flow, string[] ids)
    {
        int i = 0;
        foreach (Role role in new[] { Role.Console, Role.Multimedia, Role.Communications })
        {
            IMMDevice dev;
            string id = "";
            if (en.GetDefaultAudioEndpoint(flow, role, out dev) == 0 && dev != null)
                dev.GetId(out id);
            ids[i++] = id;
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("usage: AudioEndpoint.exe list | get <render|capture> | set <render|capture> <id> [id2] [id3] | guard <pid> <restore.json> | restore <restore.json>");
        return 2;
    }

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0) return Usage();
            var en = Com<IMMDeviceEnumerator>("BCDE0395-E52F-467C-8E3D-C4579291692E");
            if (args[0] == "list") { List(en); return 0; }
            if (args[0] == "get" && args.Length == 2)
            {
                DataFlow flow = args[1] == "capture" ? DataFlow.Capture : DataFlow.Render;
                GetDefault(en, flow);
                return 0;
            }
            if (args[0] == "guard" && args.Length >= 3)
            {
                int gpid;
                if (!int.TryParse(args[1], out gpid)) return Usage();
                return Guard(en, gpid, args[2]);
            }
            if (args[0] == "restore" && args.Length >= 2)
            {
                // Restauration immediate depuis un fichier audio-restore.json (utilisee par le
                // mode 'guard' et par la restauration manuelle de l'app)
                return RestoreFromFile(en, args[1]);
            }
            if (args[0] == "set" && args.Length >= 3)
            {
                DataFlow flow = args[1] == "capture" ? DataFlow.Capture : DataFlow.Render;
                SetDefault(flow, args[2], args.Length > 3 ? args[3] : args[2], args.Length > 4 ? args[4] : args[2]);
                return 0;
            }
            return Usage();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERREUR: " + ex.Message);
            return 1;
        }
    }
}
