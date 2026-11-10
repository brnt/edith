from edith.db.documents import EDIT, EditList


def upcast(body: dict) -> EditList:
    doc = EDIT.upcast(1, body)
    assert isinstance(doc, EditList)
    return doc


def switches(doc: EditList) -> list[tuple[float, str | None]]:
    return [(s.at_s, s.media_id) for s in doc.switches]


def test_v1_without_stills_is_unchanged():
    doc = upcast({"switches": [{"at_s": 3.0, "media_id": "camB"}], "cuts": []})
    assert switches(doc) == [(3.0, "camB")]


def test_a_v1_still_becomes_a_switch_to_it_and_a_switch_back_to_the_default_camera():
    doc = upcast({"stills": [{"id": "s", "media_id": "car", "start_s": 10.0, "end_s": 14.0}]})
    assert switches(doc) == [(10.0, "car"), (14.0, None)]  # None = the default camera


def test_the_switch_back_returns_to_the_camera_that_was_active_under_the_still():
    doc = upcast(
        {
            "switches": [{"at_s": 5.0, "media_id": "camB"}],
            "stills": [{"id": "s", "media_id": "car", "start_s": 10.0, "end_s": 14.0}],
        }
    )
    assert switches(doc) == [(5.0, "camB"), (10.0, "car"), (14.0, "camB")]


def test_a_camera_switch_hidden_under_a_still_still_applies_after_it():
    # v1 showed camA from 12 s, hidden by the still until 14 s.
    doc = upcast(
        {
            "switches": [{"at_s": 5.0, "media_id": "camB"}, {"at_s": 12.0, "media_id": "camA"}],
            "stills": [{"id": "s", "media_id": "car", "start_s": 10.0, "end_s": 14.0}],
        }
    )
    assert switches(doc) == [(5.0, "camB"), (10.0, "car"), (14.0, "camA")]


def test_back_to_back_stills_do_not_fall_back_to_a_camera_between_them():
    doc = upcast(
        {
            "stills": [
                {"id": "a", "media_id": "car", "start_s": 10.0, "end_s": 12.0},
                {"id": "b", "media_id": "bike", "start_s": 12.0, "end_s": 15.0},
            ]
        }
    )
    assert switches(doc) == [(10.0, "car"), (12.0, "bike"), (15.0, None)]


def test_other_fields_survive_and_the_stills_field_is_gone():
    doc = upcast({"stills": [], "cuts": [{"start_s": 1.0, "end_s": 2.0}], "fps_num": 25})
    assert doc.fps_num == 25 and doc.cuts[0].end_s == 2.0
    assert "stills" not in doc.model_dump()
