"""Turn a floor-plan segmentation model into the ONNX file the plan editor can run in the browser.

    pip install torch segmentation-models-pytorch safetensors onnx onnxscript
    python tools/convert_model.py best.safetensors models/floorplan.onnx

The editor expects what the model "Yytsi/floorplan-to-3d-walls" produces: a ResNet-34 U-Net, 512 x 512 RGB in (ImageNet mean and
standard deviation, the plan letterboxed), four classes out: 0 floor/background, 1 wall, 2 door, 3 window.
See docs/learned-model.md for where to get weights, and the licence question that comes with them.
"""
import sys

import torch
import segmentation_models_pytorch as smp
from safetensors.torch import load_file

src, dst = sys.argv[1], sys.argv[2]
model = smp.Unet('resnet34', encoder_weights=None, classes=4)
result = model.load_state_dict(load_file(src), strict=False)
if result.missing_keys or result.unexpected_keys:
    sys.exit(f'These weights do not fit a ResNet-34 U-Net with 4 classes: {result}')
model.eval()
torch.onnx.export(model, torch.zeros(1, 3, 512, 512), dst, input_names=['input'], output_names=['logits'], opset_version=17, dynamo=False)
print('wrote', dst)
