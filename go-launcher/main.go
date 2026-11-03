// NEXUS tool launcher: распаковывает встроенный Node.js и скрипты во временную папку и запускает run.js.
// Всё внутри одного exe — ничего устанавливать не нужно.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed all:payload node.exe.gz meta.txt
var assets embed.FS

func setupConsole(title string) {
	k := syscall.NewLazyDLL("kernel32.dll")
	k.NewProc("SetConsoleOutputCP").Call(65001)
	k.NewProc("SetConsoleCP").Call(65001)
	if t, err := syscall.UTF16PtrFromString(title); err == nil {
		k.NewProc("SetConsoleTitleW").Call(uintptr(unsafe.Pointer(t)))
	}
	// включить ANSI-цвета
	h, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	if err == nil {
		var mode uint32
		if r, _, _ := k.NewProc("GetConsoleMode").Call(uintptr(h), uintptr(unsafe.Pointer(&mode))); r != 0 {
			k.NewProc("SetConsoleMode").Call(uintptr(h), uintptr(mode|0x0004))
		}
	}
}

func fail(msg string, err error) {
	fmt.Fprintf(os.Stderr, "\n  [X] %s: %v\n", msg, err)
	fmt.Fprint(os.Stderr, "\n  Нажмите Enter, чтобы закрыть окно... ")
	var b [1]byte
	os.Stdin.Read(b[:])
	os.Exit(1)
}

func main() {
	metaRaw, _ := assets.ReadFile("meta.txt")
	meta := strings.Split(strings.TrimSpace(string(metaRaw)), "\n")
	name, title := "nexus", "NEXUS"
	if len(meta) > 0 {
		name = strings.TrimSpace(meta[0])
	}
	if len(meta) > 1 {
		title = strings.TrimSpace(meta[1])
	}
	setupConsole(title)

	// идентификатор сборки = хеш содержимого meta + размер node.exe.gz + список файлов payload
	h := sha256.New()
	h.Write(metaRaw)
	fs.WalkDir(assets, "payload", func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if info, e := d.Info(); e == nil {
				fmt.Fprintf(h, "%s:%d;", p, info.Size())
			}
		}
		return nil
	})
	if f, err := assets.Open("node.exe.gz"); err == nil {
		if st, e := f.Stat(); e == nil {
			fmt.Fprintf(h, "node:%d", st.Size())
		}
		f.Close()
	}
	id := hex.EncodeToString(h.Sum(nil))[:12]

	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	root := filepath.Join(base, "NEXUS_Tools", "run")
	dir := filepath.Join(root, name+"-"+id)
	ready := filepath.Join(dir, ".ready")
	nodePath := filepath.Join(dir, "node.exe")

	if _, err := os.Stat(ready); err != nil {
		os.RemoveAll(dir)
		tmp := dir + ".tmp"
		os.RemoveAll(tmp)
		if err := os.MkdirAll(tmp, 0o755); err != nil {
			fail("не могу создать рабочую папку "+tmp, err)
		}
		// скрипты
		err := fs.WalkDir(assets, "payload", func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel := strings.TrimPrefix(strings.TrimPrefix(p, "payload"), "/")
			if rel == "" {
				return nil
			}
			dst := filepath.Join(tmp, filepath.FromSlash(rel))
			if d.IsDir() {
				return os.MkdirAll(dst, 0o755)
			}
			data, err := assets.ReadFile(p)
			if err != nil {
				return err
			}
			return os.WriteFile(dst, data, 0o644)
		})
		if err != nil {
			fail("не удалось распаковать скрипты", err)
		}
		// node.exe
		gz, err := assets.Open("node.exe.gz")
		if err != nil {
			fail("нет встроенного node.exe", err)
		}
		zr, err := gzip.NewReader(gz)
		if err != nil {
			fail("node.exe.gz повреждён", err)
		}
		out, err := os.Create(filepath.Join(tmp, "node.exe"))
		if err != nil {
			fail("не могу записать node.exe", err)
		}
		if _, err := io.Copy(out, zr); err != nil {
			out.Close()
			fail("не удалось распаковать node.exe", err)
		}
		out.Close()
		gz.Close()
		os.WriteFile(filepath.Join(tmp, ".ready"), bytes.NewBufferString(id).Bytes(), 0o644)
		if err := os.Rename(tmp, dir); err != nil {
			fail("не удалось завершить распаковку", err)
		}
		// старые версии этого же инструмента удаляем
		if ents, err := os.ReadDir(root); err == nil {
			for _, e := range ents {
				if e.IsDir() && strings.HasPrefix(e.Name(), name+"-") && e.Name() != name+"-"+id {
					os.RemoveAll(filepath.Join(root, e.Name()))
				}
			}
		}
	}

	args := append([]string{filepath.Join(dir, "run.js")}, os.Args[1:]...)
	cmd := exec.Command(nodePath, args...)
	cmd.Dir = dir
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = append(os.Environ(), "NEXUS_EXE=1")
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			os.Exit(ee.ExitCode())
		}
		fail("не удалось запустить встроенный Node.js", err)
	}
}
