# Numerical compatibility algorithms

## SciPy normal Anderson–Darling table and interpolation

`src/copula.rs` follows the normal-distribution critical values and p-value
interpolation in SciPy 1.18.1 `scipy/stats/_morestats.py`. Source:
https://github.com/scipy/scipy/blob/v1.18.1/scipy/stats/_morestats.py

Copyright (c) 2001-2002 Enthought, Inc. 2003, SciPy Developers.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided
   with the distribution.
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived
   from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## NumPy random-number compatibility

`src/sort.rs` also adapts NumPy's introsort and heapsort algorithms, originally
due to Charles R. Harris for numarray:
https://github.com/numpy/numpy/blob/v2.3.4/numpy/_core/src/npysort/quicksort.cpp
and `npysort_heapsort.h`. NumPy's BSD 3-Clause terms below cover this adaptation.

`src/rng.rs` adapts the SeedSequence mixing/state generation and PCG64/bounded
integer algorithms from NumPy's reference implementation. Original source:

- https://github.com/numpy/numpy/blob/v2.3.4/numpy/random/bit_generator.pyx
- https://github.com/numpy/numpy/blob/v2.3.4/numpy/random/src/pcg64/pcg64.h
- https://github.com/numpy/numpy/blob/v2.3.4/numpy/random/src/distributions/distributions.c
- https://github.com/numpy/numpy/blob/v2.3.4/numpy/random/src/distributions/ziggurat_constants.h

The normal/exponential/gamma generators and unit-Dirichlet normalization also
adapt these NumPy algorithms. `src/ziggurat.rs` contains numeric tables generated
from that pinned header, preserving each f64 bit pattern. The development-only
generator verifies the header SHA-256 before writing Rust constants. The same
BSD terms below apply; no NumPy runtime is linked or invoked.

The Rust adaptation replaces C/Cython storage, ABI and arithmetic with native
wrapping Rust integers. Compatibility is verified against the frozen project's
installed NumPy; the reference version is not substituted for that oracle.

## SeedSequence and PCG: MIT License

Copyright (c) 2015 Melissa E. O'Neill
Copyright (c) 2019 NumPy Developers
PCG Random Number Generation for C: Copyright 2014 Melissa O'Neill

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## NumPy distributions: BSD 3-Clause License

Copyright (c) 2005-2025, NumPy Developers. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
