package torrentmeta

import (
	"reflect"
	"testing"
)

func TestParseReadsSingleFileTorrent(t *testing.T) {
	info, err := Parse([]byte("d6:lengthi12e4:name5:a.mkv12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae"))
	if err != nil {
		t.Fatal(err)
	}
	want := Info{
		Name:        "a.mkv",
		Files:       []File{{Index: 0, Path: "a.mkv", Size: 12}},
		PieceLength: 16384,
		Pieces:      []byte("aaaaaaaaaaaaaaaaaaaa"),
	}
	if !reflect.DeepEqual(info, want) {
		t.Fatalf("info = %+v", info)
	}
}

func TestParseReadsFilesInOrderWithPadding(t *testing.T) {
	data := "d5:filesl" +
		"d6:lengthi5e4:pathl9:Season 017:E01.mkveed" +
		"4:attr1:p6:lengthi3e4:pathl4:.pad1:3eed" +
		"6:lengthi4e10:path.utf-8l7:E02.mkvee" +
		"e4:name4:Show12:piece lengthi16e6:pieces0:e"
	info, err := Parse([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	want := Info{Name: "Show", Files: []File{
		{Index: 0, Path: "Season 01/E01.mkv", Size: 5},
		{Index: 1, Path: ".pad/3", Size: 3, Padding: true, Offset: 5},
		{Index: 2, Path: "E02.mkv", Size: 4, Offset: 8},
	}, PieceLength: 16, Pieces: []byte{}}
	if !reflect.DeepEqual(info, want) {
		t.Fatalf("info = %+v", info)
	}
}

func TestParseRefusesBadDictionaries(t *testing.T) {
	for _, data := range []string{
		"", "le", "d4:name1:ae",
		"d4:name2:..6:lengthi1ee",
		"d5:filesle4:name1:ae",
		"d5:filesld6:lengthi1e4:pathl2:..eee4:name1:ae",
		"d5:filesld6:lengthi-1e4:pathl1:beee4:name1:ae",
		"d6:lengthi1e4:name1:aetrailing",
		"di1e1:ae",
	} {
		if _, err := Parse([]byte(data)); err == nil {
			t.Errorf("Parse(%q) succeeded", data)
		}
	}
}
