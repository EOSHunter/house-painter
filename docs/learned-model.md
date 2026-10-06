# A learned model for finding walls (optional)

The plan editor's **Suggest walls** works with plain image processing and needs nothing else. For plans it can't read (hand-drawn, hatched or
shaded walls, odd styles) you can have a **learned model** find the walls instead. It is optional, it is a file *you* provide, and it runs
**on your own computer, in the browser**: the picture is never uploaded and no account or paid service is involved.

## What it does

In **Suggest walls**, set **How walls are found** to **A learned model**, and choose a model file once (the browser keeps it). The model marks
which pixels of the picture are wall, door and window. The same tidying as always turns that into straight walls with centre lines, thicknesses,
outside/inside, doors and windows. The model replaces the *looking* (what is wall); the *measuring* is still ours. You still review every
suggestion before it is added.

The first time, the editor loads onnxruntime-web (the engine that runs the file, Apache-2.0/MIT) from a public CDN.

## What kind of file

An **ONNX** file of a segmentation network that takes a 512 x 512 RGB picture (the plan fitted into the square without stretching, the empty
border filled with the ImageNet mean, colours normalised with the ImageNet mean and standard deviation) and gives four classes per pixel:
0 floor/background, 1 wall, 2 door, 3 window.

## Getting one

This project does **not** ship a model. One that fits is the ResNet-34 U-Net trained on the CubiCasa5K data set by
[Yytsi/floorplan-to-3d-walls](https://huggingface.co/Yytsi/floorplan-to-3d-walls) (MIT licensed code and weights, a 98 MB `best.safetensors`).
To turn it into the ONNX file the editor reads:

```
pip install torch segmentation-models-pytorch safetensors onnx onnxscript
python tools/convert_model.py best.safetensors models/floorplan.onnx
```

(`models/` is ignored by git.) Then choose `floorplan.onnx` in the editor.

## Read this before you use or share a model

- **Licences.** The weights above are MIT licensed, but they were trained on **CubiCasa5K, which is released for non-commercial use** (CC BY-NC 4.0).
  Whether that carries over to the model's output is for you to decide; for your own house it is generally not a worry, for a commercial product it
  may be. That is why no model is bundled here, and why the file is yours to fetch and convert.
- **What it learned.** CubiCasa5K is mostly Nordic apartment plans drawn in one CAD style. On a plan that looks like that it does well; on a
  photo of a hand drawing, or a very different style, it may find little or find clutter. Tested here on a drawn plan with thick walls, door
  swings and windows: it found the walls and told the doors from the windows. It has **not** been tested on many real plans.
- **Size and speed.** The file is about 98 MB and runs on your processor (WebAssembly): a second or a few seconds per plan after it has loaded.
- **Resolution.** The model sees the plan at 512 x 512, so walls thinner than about a pixel at that size (a very large plan with thin walls) can be
  lost. Crop the picture to the house if that happens.
