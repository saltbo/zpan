// Package torrentmeta reads the info dictionary out of torrent metadata. The
// torrent cache keys a torrent by the SHA-1 of its bencoded info dictionary, so
// the dictionary is returned byte for byte as it appears in the file.
package torrentmeta

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
)

var ErrInvalid = errors.New("torrent metadata is invalid")

// InfoDict returns the bencoded info dictionary of a .torrent file. Data that
// is itself an info dictionary (it has no `info` key) is returned unchanged.
func InfoDict(data []byte) ([]byte, error) {
	end, err := skip(data, 0)
	if err != nil || end != len(data) || data[0] != 'd' {
		return nil, ErrInvalid
	}
	pos := 1
	for pos < len(data) && data[pos] != 'e' {
		keyStart := pos
		keyEnd, err := skip(data, pos)
		if err != nil || data[keyStart] < '0' || data[keyStart] > '9' {
			return nil, ErrInvalid
		}
		valueEnd, err := skip(data, keyEnd)
		if err != nil {
			return nil, ErrInvalid
		}
		if bytes.Equal(stringValue(data[keyStart:keyEnd]), []byte("info")) {
			if data[keyEnd] != 'd' {
				return nil, ErrInvalid
			}
			return data[keyEnd:valueEnd], nil
		}
		pos = valueEnd
	}
	return data, nil
}

// InfoHash is the lowercase hex v1 infoHash of an info dictionary.
func InfoHash(info []byte) string {
	sum := sha1.Sum(info)
	return hex.EncodeToString(sum[:])
}

func stringValue(encoded []byte) []byte {
	colon := bytes.IndexByte(encoded, ':')
	return encoded[colon+1:]
}

// skip returns the offset just past the bencoded value starting at pos.
func skip(data []byte, pos int) (int, error) {
	if pos >= len(data) {
		return 0, ErrInvalid
	}
	switch c := data[pos]; {
	case c == 'i':
		end := bytes.IndexByte(data[pos:], 'e')
		if end < 2 {
			return 0, ErrInvalid
		}
		return pos + end + 1, nil
	case c == 'l' || c == 'd':
		pos++
		for pos < len(data) && data[pos] != 'e' {
			next, err := skip(data, pos)
			if err != nil {
				return 0, err
			}
			pos = next
		}
		if pos >= len(data) {
			return 0, ErrInvalid
		}
		return pos + 1, nil
	case c >= '0' && c <= '9':
		colon := bytes.IndexByte(data[pos:], ':')
		if colon < 1 {
			return 0, ErrInvalid
		}
		var length int
		if _, err := fmt.Sscanf(string(data[pos:pos+colon]), "%d", &length); err != nil || length < 0 {
			return 0, ErrInvalid
		}
		end := pos + colon + 1 + length
		if end > len(data) {
			return 0, ErrInvalid
		}
		return end, nil
	}
	return 0, ErrInvalid
}
