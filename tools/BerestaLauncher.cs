// BerestaLauncher.cs — лаунчер БЕРЕСТА: запускает сервер (runtime\node.exe
// или системный Node) и открывает браузер. Компиляция:
// csc /nologo /target:exe /win32icon:emblem.ico /out:beresta.exe BerestaLauncher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class BerestaLauncher {
    static int Main(string[] args) {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.Title = "БЕРЕСТА";
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "runtime", "node.exe");
        if (!File.Exists(node)) node = "node"; // системный Node.js как запасной вариант
        string server = Path.Combine(root, "server.js");

        Console.WriteLine();
        Console.WriteLine("  ======================================================");
        Console.WriteLine("   БЕРЕСТА - Учебная топографическая система");
        Console.WriteLine("  ======================================================");
        Console.WriteLine();
        Console.WriteLine("   Адрес:      http://localhost:7100/");
        Console.WriteLine("   Остановка:  закройте это окно или нажмите Ctrl+C");
        Console.WriteLine();

        // Браузер открываем с задержкой 2 сек, чтобы сервер успел подняться
        var t = new Thread(() => {
            Thread.Sleep(2000);
            try {
                Process.Start(new ProcessStartInfo("http://localhost:7100/") { UseShellExecute = true });
            } catch { /* браузер не открылся — не страшно, адрес на экране */ }
        });
        t.IsBackground = true;
        t.Start();

        var psi = new ProcessStartInfo(node, "\"" + server + "\" " + string.Join(" ", args)) {
            WorkingDirectory = root,
            UseShellExecute = false
        };
        try {
            var p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        } catch (Exception e) {
            Console.WriteLine();
            Console.WriteLine("  [ОШИБКА] Node.js не найден ни в папке runtime, ни в системе!");
            Console.WriteLine("  " + e.Message);
            Console.WriteLine();
            Console.WriteLine("  Нажмите любую клавишу...");
            try { Console.ReadKey(true); } catch { }
            return 1;
        }
    }
}
