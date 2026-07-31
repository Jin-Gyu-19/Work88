"""
이미지 편집 다이얼로그
- 이미지를 마우스 드래그/휠로 pan·zoom
- 정사각형 crop frame에 맞춰 추출
- 결과: 정사각형 QImage (기본 512×512)
"""
import os

from PyQt6.QtCore import Qt, QRectF, pyqtSignal
from PyQt6.QtGui import (
    QPixmap, QPainter, QImage, QPainterPath, QRegion, QColor,
)
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QGraphicsView, QGraphicsScene, QGraphicsPixmapItem,
    QSlider, QMessageBox, QFileDialog,
)


# ─────────────────────────────────────────────────────────────
# Crop View — pan/zoom 가능한 이미지 뷰
# ─────────────────────────────────────────────────────────────
class ImageCropView(QGraphicsView):
    """이미지를 마우스 드래그/휠로 pan·zoom 가능. viewport 영역 = crop 결과."""

    zoomChanged = pyqtSignal(int)  # 줌 변경 시 슬라이더 동기화용 (퍼센트)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._scene = QGraphicsScene(self)
        self.setScene(self._scene)
        self.setRenderHints(
            QPainter.RenderHint.SmoothPixmapTransform | QPainter.RenderHint.Antialiasing
        )
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.setFrameShape(QGraphicsView.Shape.NoFrame)
        self._pix_item = None
        self._base_scale = 1.0  # fitInView 시점의 base scale
        self._cur_scale = 1.0   # 현재 누적 scale

    def load_image(self, path: str) -> bool:
        pix = QPixmap(path)
        if pix.isNull():
            return False
        self._scene.clear()
        self._pix_item = QGraphicsPixmapItem(pix)
        self._pix_item.setTransformationMode(Qt.TransformationMode.SmoothTransformation)
        self._scene.addItem(self._pix_item)
        # scene 영역을 이미지 크기로
        self._scene.setSceneRect(QRectF(pix.rect()))
        # viewport에 맞춤 (KeepAspectRatioByExpanding이면 viewport를 꽉 채움)
        self.resetTransform()
        self.fitInView(self._pix_item, Qt.AspectRatioMode.KeepAspectRatioByExpanding)
        self._base_scale = self.transform().m11()  # 현재 적용된 scale
        self._cur_scale = 1.0
        return True

    def wheelEvent(self, e):
        if not self._pix_item:
            return
        factor = 1.15 if e.angleDelta().y() > 0 else 1 / 1.15
        self._apply_zoom_factor(factor)

    def _apply_zoom_factor(self, factor: float):
        new_scale = self._cur_scale * factor
        # 최소 50% ~ 최대 500%
        new_scale = max(0.5, min(5.0, new_scale))
        # 실제 적용할 변화량
        delta = new_scale / self._cur_scale
        self.scale(delta, delta)
        self._cur_scale = new_scale
        self.zoomChanged.emit(int(new_scale * 100))

    def set_zoom_percent(self, percent: int):
        if not self._pix_item:
            return
        target = max(0.5, min(5.0, percent / 100.0))
        delta = target / self._cur_scale
        self.scale(delta, delta)
        self._cur_scale = target

    def get_cropped_image(self, output_size: int = 512) -> QImage:
        """현재 viewport에 보이는 영역을 정사각형 QImage로 반환."""
        if not self._pix_item:
            return QImage()
        vp_rect = self.viewport().rect()
        img = QImage(vp_rect.size(), QImage.Format.Format_ARGB32)
        img.fill(Qt.GlobalColor.transparent)
        painter = QPainter(img)
        painter.setRenderHints(
            QPainter.RenderHint.Antialiasing | QPainter.RenderHint.SmoothPixmapTransform
        )
        # viewport에 보이는 영역 그대로 캡처 (transform 포함됨)
        self.render(painter, QRectF(img.rect()), vp_rect)
        painter.end()
        # 최종 사이즈로 스케일 (정사각형)
        out = img.scaled(
            output_size, output_size,
            Qt.AspectRatioMode.IgnoreAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        return out


# ─────────────────────────────────────────────────────────────
# Image Editor Dialog
# ─────────────────────────────────────────────────────────────
class ImageEditorDialog(QDialog):
    """이미지 편집 다이얼로그 — pan/zoom 후 crop된 정사각형 결과 반환.

    사용 예:
        dlg = ImageEditorDialog(parent, theme, "/path/to/image.png")
        if dlg.exec() == QDialog.DialogCode.Accepted:
            qimg = dlg.result_image  # QImage
    """

    def __init__(self, parent, theme: dict, source_path: str, output_size: int = 512):
        super().__init__(parent)
        self.theme = theme
        self.source_path = source_path
        self.output_size = output_size
        self.result_image: QImage | None = None
        self._drag_pos = None

        self.setWindowTitle("이미지 편집")
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, False)
        self.setFixedSize(520, 600)

        self._build_ui()
        self._apply_style()
        # 이미지 로드 (viewport 크기 잡힌 후)
        from PyQt6.QtCore import QTimer
        QTimer.singleShot(0, self._load_image)

    # ── UI ─────────────────────────────────────────────────
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 18, 20, 20)
        root.setSpacing(14)

        # 타이틀 row
        title_row = QHBoxLayout()
        title = QLabel("🖼️ 이미지 편집")
        title.setObjectName("title")
        title_row.addWidget(title)
        title_row.addStretch()
        close_btn = QPushButton("✕")
        close_btn.setObjectName("close_btn")
        close_btn.setFixedSize(26, 26)
        close_btn.clicked.connect(self.reject)
        title_row.addWidget(close_btn)
        root.addLayout(title_row)

        # 안내
        info = QLabel("드래그로 위치 조정, 휠 또는 슬라이더로 확대·축소")
        info.setObjectName("info")
        info.setWordWrap(True)
        root.addWidget(info)

        # crop view (정사각형)
        self.view = ImageCropView(self)
        self.view.setFixedSize(440, 440)
        self.view.zoomChanged.connect(self._sync_slider_from_view)
        root.addWidget(self.view, alignment=Qt.AlignmentFlag.AlignCenter)

        # 줌 슬라이더
        zoom_row = QHBoxLayout()
        zoom_row.setSpacing(12)
        zoom_label = QLabel("🔍")
        zoom_row.addWidget(zoom_label)
        self.zoom_slider = QSlider(Qt.Orientation.Horizontal)
        self.zoom_slider.setRange(50, 300)
        self.zoom_slider.setValue(100)
        self.zoom_slider.valueChanged.connect(self._on_slider_changed)
        zoom_row.addWidget(self.zoom_slider, 1)
        self.zoom_val = QLabel("100%")
        self.zoom_val.setFixedWidth(48)
        self.zoom_val.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        zoom_row.addWidget(self.zoom_val)
        root.addLayout(zoom_row)

        # 액션 버튼
        btn_row = QHBoxLayout()
        btn_row.addStretch()
        cancel = QPushButton("취소")
        cancel.clicked.connect(self.reject)
        btn_row.addWidget(cancel)
        ok = QPushButton("적용")
        ok.setObjectName("ok_btn")
        ok.clicked.connect(self._on_accept)
        btn_row.addWidget(ok)
        root.addLayout(btn_row)

    def _apply_style(self):
        t = self.theme
        self.setStyleSheet(f"""
            QDialog {{
                background: {t['bg']};
                border: 1px solid {t['border']};
            }}
            QLabel#title {{
                color: {t['accent']};
                font-size: 15px;
                font-weight: 700;
                background: transparent;
            }}
            QPushButton#close_btn {{
                background: transparent;
                color: {t['btn_sub']};
                border: none;
                font-size: 13px;
                font-weight: 700;
            }}
            QPushButton#close_btn:hover {{
                color: {t['danger']};
                background: {t['danger']}22;
                border-radius: 4px;
            }}
            QLabel#info {{
                color: {t['btn_sub']};
                font-size: 11px;
                background: transparent;
            }}
            QGraphicsView {{
                background: {t['header']};
                border: 1px solid {t['border']};
                border-radius: 8px;
            }}
            QLabel {{
                color: {t['btn_text']};
                font-size: 12px;
                background: transparent;
            }}
            QSlider::groove:horizontal {{
                background: {t['border']};
                height: 4px;
                border-radius: 2px;
            }}
            QSlider::sub-page:horizontal {{
                background: {t['accent']};
                height: 4px;
                border-radius: 2px;
            }}
            QSlider::handle:horizontal {{
                background: {t['accent']};
                width: 16px;
                height: 16px;
                margin: -6px 0;
                border-radius: 8px;
            }}
            QPushButton {{
                background: {t['btn_bg']};
                color: {t['btn_text']};
                border: 1px solid {t['border']};
                border-radius: 6px;
                padding: 8px 24px;
                font-size: 12px;
                font-weight: 500;
            }}
            QPushButton:hover {{
                border-color: {t['accent']};
                color: {t['accent']};
            }}
            QPushButton#ok_btn {{
                background: {t['accent']};
                color: {t['bg']};
                border: 1px solid {t['accent']};
                font-weight: 700;
            }}
            QPushButton#ok_btn:hover {{
                background: {t['accent']};
                color: {t['bg']};
                border-color: {t['btn_text']};
            }}
        """)

    def resizeEvent(self, e):
        super().resizeEvent(e)
        try:
            r = 16
            p = QPainterPath()
            p.addRoundedRect(QRectF(self.rect()), r, r)
            self.setMask(QRegion(p.toFillPolygon().toPolygon()))
        except Exception:
            pass

    # ── 헤더 드래그로 다이얼로그 이동 ─────────────────────
    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton and e.position().y() < 50:
            self._drag_pos = e.globalPosition().toPoint() - self.frameGeometry().topLeft()
            return
        super().mousePressEvent(e)

    def mouseMoveEvent(self, e):
        if e.buttons() == Qt.MouseButton.LeftButton and self._drag_pos:
            self.move(e.globalPosition().toPoint() - self._drag_pos)
            return
        super().mouseMoveEvent(e)

    def mouseReleaseEvent(self, e):
        self._drag_pos = None
        super().mouseReleaseEvent(e)

    # ── 동작 ──────────────────────────────────────────────
    def _load_image(self):
        if not self.view.load_image(self.source_path):
            QMessageBox.warning(self, "오류", f"이미지를 열 수 없어요:\n{self.source_path}")
            self.reject()

    def _on_slider_changed(self, v: int):
        self.view.set_zoom_percent(v)
        self.zoom_val.setText(f"{v}%")

    def _sync_slider_from_view(self, percent: int):
        # view에서 휠로 변경 시 슬라이더만 갱신 (loop 방지)
        self.zoom_slider.blockSignals(True)
        self.zoom_slider.setValue(percent)
        self.zoom_slider.blockSignals(False)
        self.zoom_val.setText(f"{percent}%")

    def _on_accept(self):
        try:
            self.result_image = self.view.get_cropped_image(self.output_size)
            self.accept()
        except Exception as e:
            QMessageBox.warning(self, "오류", f"이미지 처리 중 오류:\n{e}")


# ─────────────────────────────────────────────────────────────
# 헬퍼: 파일 선택 → 편집 → 저장 한 번에
# ─────────────────────────────────────────────────────────────
def pick_and_edit_image(parent, theme: dict, save_path: str,
                        output_size: int = 512) -> bool:
    """파일 선택 다이얼로그 → ImageEditorDialog → save_path에 PNG 저장.

    save_path: 저장될 절대 경로 (.png)
    Returns: True 저장 완료, False 취소/실패
    """
    src, _ = QFileDialog.getOpenFileName(
        parent, "이미지 선택", "",
        "이미지 파일 (*.png *.jpg *.jpeg *.bmp *.webp *.gif);;모든 파일 (*)"
    )
    if not src:
        return False

    dlg = ImageEditorDialog(parent, theme, src, output_size=output_size)
    if dlg.exec() != QDialog.DialogCode.Accepted:
        return False

    if dlg.result_image is None or dlg.result_image.isNull():
        return False

    try:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        ok = dlg.result_image.save(save_path, "PNG")
        return bool(ok)
    except Exception as e:
        QMessageBox.warning(parent, "오류", f"저장 실패:\n{e}")
        return False
