package torrentmeta

import (
	"bytes"
	"strings"
)

// File is one file of a torrent, in info dictionary order.
type File struct {
	// Index is the file's position in the info dictionary, padding files
	// included.
	Index int
	// Path is slash-separated inside the torrent; a single-file torrent's is
	// its name.
	Path string
	Size int64
	// Padding marks a BEP 47 padding file, which counts for piece boundaries
	// but is never downloaded as a file.
	Padding bool
}

// Info is what the downloader needs of an info dictionary to find each file
// of the torrent in a finished download.
type Info struct {
	Name  string
	Files []File
}

// Parse reads the name and files of a bencoded info dictionary. Paths are
// rejected when a segment is empty, `.`, `..`, or holds a separator.
func Parse(info []byte) (Info, error) {
	root, end, err := decode(info, 0)
	if err != nil || end != len(info) {
		return Info{}, ErrInvalid
	}
	dict, ok := root.(map[string]any)
	if !ok {
		return Info{}, ErrInvalid
	}
	name, ok := text(dict, "name")
	if !ok || !validSegment(name) {
		return Info{}, ErrInvalid
	}
	out := Info{Name: name}
	list, multi := dict["files"]
	if !multi {
		length, ok := dict["length"].(int64)
		if !ok || length < 0 {
			return Info{}, ErrInvalid
		}
		out.Files = []File{{Index: 0, Path: name, Size: length}}
		return out, nil
	}
	entries, ok := list.([]any)
	if !ok || len(entries) == 0 {
		return Info{}, ErrInvalid
	}
	for index, value := range entries {
		entry, ok := value.(map[string]any)
		if !ok {
			return Info{}, ErrInvalid
		}
		raw, ok := entry["path.utf-8"].([]any)
		if !ok {
			raw, ok = entry["path"].([]any)
		}
		if !ok || len(raw) == 0 {
			return Info{}, ErrInvalid
		}
		segments := make([]string, 0, len(raw))
		for _, segment := range raw {
			value, ok := segment.([]byte)
			if !ok || !validSegment(string(value)) {
				return Info{}, ErrInvalid
			}
			segments = append(segments, string(value))
		}
		length, ok := entry["length"].(int64)
		if !ok || length < 0 {
			return Info{}, ErrInvalid
		}
		attr, _ := entry["attr"].([]byte)
		padding := bytes.ContainsRune(attr, 'p') || (len(segments) > 1 && segments[0] == ".pad")
		out.Files = append(out.Files, File{Index: index, Path: strings.Join(segments, "/"), Size: length, Padding: padding})
	}
	return out, nil
}

func text(dict map[string]any, key string) (string, bool) {
	if value, ok := dict[key+".utf-8"].([]byte); ok {
		return string(value), true
	}
	value, ok := dict[key].([]byte)
	return string(value), ok
}

func validSegment(segment string) bool {
	return segment != "" && segment != "." && segment != ".." && !strings.ContainsAny(segment, "/\\\x00")
}

// decode reads the bencoded value at pos: an int64, a []byte, a []any, or a
// map[string]any.
func decode(data []byte, pos int) (any, int, error) {
	end, err := skip(data, pos)
	if err != nil {
		return nil, 0, err
	}
	switch c := data[pos]; {
	case c == 'i':
		var n int64
		digits := data[pos+1 : end-1]
		negative := len(digits) > 0 && digits[0] == '-'
		if negative {
			digits = digits[1:]
		}
		if len(digits) == 0 || len(digits) > 18 {
			return nil, 0, ErrInvalid
		}
		for _, digit := range digits {
			if digit < '0' || digit > '9' {
				return nil, 0, ErrInvalid
			}
			n = n*10 + int64(digit-'0')
		}
		if negative {
			n = -n
		}
		return n, end, nil
	case c == 'l':
		var list []any
		for at := pos + 1; at < end-1; {
			value, next, err := decode(data, at)
			if err != nil {
				return nil, 0, err
			}
			list = append(list, value)
			at = next
		}
		return list, end, nil
	case c == 'd':
		dict := map[string]any{}
		for at := pos + 1; at < end-1; {
			if data[at] < '0' || data[at] > '9' {
				return nil, 0, ErrInvalid
			}
			key, next, err := decode(data, at)
			if err != nil {
				return nil, 0, err
			}
			if next >= end-1 {
				return nil, 0, ErrInvalid
			}
			value, after, err := decode(data, next)
			if err != nil {
				return nil, 0, err
			}
			dict[string(key.([]byte))] = value
			at = after
		}
		return dict, end, nil
	default:
		return stringValue(data[pos:end]), end, nil
	}
}
