cmake_minimum_required(VERSION 3.15)
project(live_media_hdr LANGUAGES C CXX)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(UHDR_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(UHDR_ENABLE_HEIF OFF CACHE BOOL "" FORCE)
set(UHDR_ENABLE_INTRINSICS OFF CACHE BOOL "" FORCE)
set(UHDR_BUILD_DEPS ON CACHE BOOL "" FORCE)
add_subdirectory(${UHDR_SOURCE} ultrahdr)
add_executable(live_hdr ultrahdr.cpp)
target_include_directories(live_hdr PRIVATE ${UHDR_SOURCE})
target_link_libraries(live_hdr PRIVATE uhdr)
set_target_properties(live_hdr PROPERTIES SUFFIX ".js")
target_link_options(live_hdr PRIVATE
  "-sMODULARIZE=1" "-sEXPORT_NAME=createUltraHDR" "-sENVIRONMENT=worker"
  "-sALLOW_MEMORY_GROWTH=1" "-sMAXIMUM_MEMORY=1073741824" "-sFILESYSTEM=0"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']"
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_lm_probe','_lm_reencode','_lm_output_size','_lm_fixture','_lm_error']"
  "--no-entry")
