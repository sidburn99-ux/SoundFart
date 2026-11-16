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
        int GetValue(ref PropertyKey key, IntPtr pv);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
    }

    // PROPVARIANT natif = 24 octets x64 : le marshaling par valeur d'une
    // struct sous-dimensionnee corrompt la pile. IntPtr alloue a la place ;
    // GetValue est un out-param (pas besoin de PropVariantInit, absent d'ole32).
    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(IntPtr pvar);

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
            IntPtr pv = Marshal.AllocCoTaskMem(24); // PROPVARIANT : 24 o couvre x64/x86
            Marshal.WriteInt16(pv, 0, 0); // vt = VT_EMPTY : si GetValue echoue, Clear est un no-op sur une variante vide (AllocCoTaskMem ne zero pas)
            string name = "";
            try
            {
                int ghr = store.GetValue(ref key, pv);
                if (ghr == 0)
                {
                    if (Marshal.ReadInt16(pv, 0) == 31) // VT_LPWSTR
                    {
                        IntPtr bstr = Marshal.ReadIntPtr(pv, 8); // union a l'offset 8
                        if (bstr != IntPtr.Zero) name = Marshal.PtrToStringUni(bstr) ?? "";
                    }
                }
            }
            finally { PropVariantClear(pv); Marshal.FreeCoTaskMem(pv); } // libere le BSTR du store
            return name;
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
                string id;
                if (dev.GetId(out id) != 0 || string.IsNullOrEmpty(id)) continue; // endpoint sans id : fantome, inutilisable pour la restauration
                string name = DeviceName(dev);
                // \r isole (non suivi de \n) injecterait une fausse ligne dans
                // la sortie -> endpoint fantome pour parseEndpoints.
                Console.WriteLine((flow == DataFlow.Render ? "render" : "capture") + "|" + id + "|" + name.Replace("\r", " ").Replace("\n", " ").Replace("|", "/"));
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
            {
                int gidHr = dev.GetId(out id);
                if (gidHr != 0) Console.Error.WriteLine("get: GetId role " + role + " hr=0x" + gidHr.ToString("X8"));
            }
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
        // Journaliser chaque role : un echec partiel (console ok, comm ko)
        // rendait la restauration incomplete sans aucun diagnostic.
        Console.Error.WriteLine("set console=0x" + hr1.ToString("X8") + " comm=0x" + hr2.ToString("X8") + " multi=0x" + hr3.ToString("X8"));
        // Strict par role : un echec partiel (console ok, comm ko) doit
        // refuser le succes — sinon l'appelant supprime le marqueur de
        // restauration et l'etat Windows reste incoherent definitivement.
        var fails = new List<string>();
        if (hr1 != 0) fails.Add("console=0x" + hr1.ToString("X8"));
        if (hr2 != 0) fails.Add("comm=0x" + hr2.ToString("X8"));
        if (hr3 != 0) fails.Add("multi=0x" + hr3.ToString("X8"));
        if (fails.Count > 0)
            throw new Exception("SetDefaultEndpoint partiel: " + string.Join(" ", fails.ToArray()));
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
        foreach (var kv in caps) if (kv.Key == id) return !string.IsNullOrEmpty(kv.Value) && !VIRTUAL_RE.IsMatch(kv.Value);
        return false;
    }

    // Restauration immediate depuis un fichier audio-restore.json (utilisee par le
    // mode 'restore' et par 'guard' apres la mort du parent). Retourne 0 si le
    // fichier a ete consomme, 1 sinon.
    private static int RestoreFromFile(IMMDeviceEnumerator en, string restorePath, string expectedOwner = null)
    {
        try
        {
            if (!System.IO.File.Exists(restorePath)) return 0; // rien a faire
            string json = System.IO.File.ReadAllText(restorePath);
            // Revérifier l'owner sur CETTE lecture : entre le check du guard et
            // celle-ci, une nouvelle instance a pu reecrire le marqueur — sans
            // ca on restaurerait (et supprimerait) le fichier d'un autre run.
            if (expectedOwner != null)
            {
                var mOwn = System.Text.RegularExpressions.Regex.Match(json, "\"owner\"\\s*:\\s*(\\d+)");
                if (!mOwn.Success || mOwn.Groups[1].Value != expectedOwner) return 0;
            }
            var caps = new System.Collections.Generic.List<KeyValuePair<string, string>>();
            IntPtr pColl;
            if (en.EnumAudioEndpoints(DataFlow.Capture, DEVICE_STATE_ACTIVE, out pColl) != 0 || pColl == IntPtr.Zero) return 1;
            var coll = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pColl);
            int count; coll.GetCount(out count);
            for (int i = 0; i < count; i++)
            {
                IMMDevice d;
                if (coll.Item(i, out d) != 0) continue;
                string id;
                if (d.GetId(out id) != 0 || string.IsNullOrEmpty(id)) continue;
                caps.Add(new KeyValuePair<string, string>(id, DeviceName(d)));
            }
            var g = new string[3];
            GetDefault(en, DataFlow.Capture, g);
            string prevC = RegexVal(json, "console"), prevM = RegexVal(json, "comm"), prevX = RegexVal(json, "multi");
            string defId = NonVirtual(g[1], caps) ? g[1] : ""; // role multimedia = defaut Windows fiable
            string fb = "";
            // Nom non vide exige : un DeviceName illisible renvoyait "" qui
            // passait VIRTUAL_RE — le virtuel aurait ete choisi comme repli
            // (parite avec chooseRestoreIds cote JS, SF-REL-0660).
            foreach (var kv in caps) if (!string.IsNullOrEmpty(kv.Value) && !VIRTUAL_RE.IsMatch(kv.Value)) { fb = kv.Key; break; }
            string cId = defId != "" ? defId : (NonVirtual(prevC, caps) ? prevC : "") ;
            if (cId == "") cId = fb;
            string mId = defId != "" ? defId : (NonVirtual(prevM, caps) ? prevM : "");
            if (mId == "") mId = fb;
            // role Multimedia : priorite au multi d'origine enregistre, puis
            // repli sur la cible console/comm — jamais perdu silencieusement.
            string xId = defId != "" ? defId : (NonVirtual(prevX, caps) ? prevX : "");
            if (xId == "") xId = cId != "" ? cId : mId;
            if (cId == "" && mId == "") return 1; // aucun micro : on garde le fichier pour retry ulterieur
            try
            {
                SetDefault(DataFlow.Capture, cId != "" ? cId : mId, mId != "" ? mId : cId, xId);
            }
            catch
            {
                // Echec partiel ou total : on NE supprime PAS le marqueur —
                // une restauration incomplete pourra etre retentee.
                return 1;
            }
            try { System.IO.File.Delete(restorePath); }
            catch (Exception dex) { try { Console.Error.WriteLine("restore: suppression marqueur: " + dex.Message); } catch {} }
            return 0;
        }
        catch (Exception ex)
        {
            try { Console.Error.WriteLine("restore: " + ex.Message); } catch {}
            return 1;
        }
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
                using (var proc = System.Diagnostics.Process.GetProcessById(pid))
                {
                    if (proc.StartTime != startTime) return 0; // PID reutilise : ce n'est plus notre parent
                }
            }
            catch (ArgumentException) { break; } // processus inexistant : parent mort
            catch { /* acces refuse/integrite : on continue a sonder, jamais restaurer sur un doute */ }
            // Sortie anticipee : si le marqueur a ete consomme (restauration
            // manuelle / will-quit) ou adopte par une autre instance pendant
            // que le parent vit, ce guard n'a plus de role — sans ce test, N
            // bascules accumulaient N guards jusqu'a la mort du parent.
            try
            {
                if (!System.IO.File.Exists(restorePath)) return 0;
                string j = System.IO.File.ReadAllText(restorePath);
                var mo = System.Text.RegularExpressions.Regex.Match(j, "\"owner\"\\s*:\\s*(\\d+)");
                if (mo.Success && mo.Groups[1].Value != pid.ToString()) return 0;
            }
            catch { /* lecture transitoire (rename .tmp->json en cours) : on continue */ }
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
        // Retry borne : un echec transitoire de SetDefaultEndpoint (service
        // audio occupe, endpoint en renegociation) tuait le guard one-shot
        // et laissait le micro coince sans recours jusqu'au prochain lancement.
        for (int attempt = 0; attempt < 5; attempt++)
        {
            int rc = RestoreFromFile(en, restorePath, pid.ToString());
            if (rc == 0 || !System.IO.File.Exists(restorePath)) return rc;
            System.Threading.Thread.Sleep(2000 * (attempt + 1)); // backoff 2s -> 10s
        }
        return 1;
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
            {
                int gidHr = dev.GetId(out id);
                if (gidHr != 0) id = ""; // id invalide : ne pas restaurer sur un id errone
            }
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
            // Les noms d'appareils non-ASCII (accents) doivent survivre au
            // pipe vers Node (decode utf8) : sans ca la console OEM corrompt.
            try { Console.OutputEncoding = System.Text.Encoding.UTF8; } catch {}
            if (args.Length == 0) return Usage();
            var en = Com<IMMDeviceEnumerator>("BCDE0395-E52F-467C-8E3D-C4579291692E");
            if (args[0] == "list") { List(en); return 0; }
            if (args[0] == "get" && args.Length == 2)
            {
                if (args[1] != "capture" && args[1] != "render") return Usage();
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
                if (args[1] != "capture" && args[1] != "render") return Usage();
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
